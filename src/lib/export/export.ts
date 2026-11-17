import JSZip from "jszip";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { BrandScope } from "../brands/scope";
import { brands, exportsTable, masterPosts, postVariants } from "../db/schema";
import { platformLabel, platformRules, type Platform } from "../platforms";
import { variantImages } from "../render/render";
import { brandKey, getStorage } from "../storage";
import { slugify } from "../brands/service";
import type { Variant } from "../posts/produce";

type Brand = typeof brands.$inferSelect;
export class ExportError extends Error {}

/** RFC 4180 CSV: every field quoted, CRLF line ends, UTF-8 BOM so Excel opens accents/emoji correctly. */
export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [headers, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}

/**
 * Metricool bulk-upload CSV (one row per platform variant). Metricool creates one post per row and enables only
 * the network columns set to TRUE. Its importer takes media as public URLs ("Picture Url N"): set
 * PUBLIC_MEDIA_BASE_URL to where the ZIP's folders are hosted, otherwise the columns hold the relative file paths
 * and media are attached by hand. Column names follow Metricool's bulk template; see docs/EXPORT.md.
 */
export const METRICOOL_NETWORKS: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube_shorts: "Youtube",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x_threads: "Twitter",
};
const NETWORK_COLUMNS = ["Facebook", "Twitter", "LinkedIn", "GMB", "Instagram", "Pinterest", "TikTok", "Youtube", "Threads", "Bluesky"];
export const METRICOOL_HEADERS = [
  "Text",
  "Date",
  "Time",
  "Draft",
  ...NETWORK_COLUMNS,
  ...Array.from({ length: 10 }, (_, i) => `Picture Url ${i + 1}`),
  "Instagram Post Type",
  "Facebook Post Type",
  "Youtube Video Title",
  "LinkedIn Type",
];

export const GENERIC_HEADERS = ["date", "time", "platform", "language", "format", "width", "height", "caption", "hashtags", "full_text", "title", "cta", "file_names", "folder", "note"];

const folderName = (v: Variant, langs: number) => `${v.platform}${langs > 1 ? `_${v.language}` : ""}`;
const fullText = (v: Variant) => [v.copy.caption, v.copy.hashtags.join(" ")].filter(Boolean).join("\n\n");

function storyboardMarkdown(v: Variant, date: string) {
  const sb = v.storyboard!;
  return [
    `# ${sb.label}`,
    "",
    `${platformLabel(v.platform)} · ${v.language.toUpperCase()} · ${date} · 1080×1920`,
    "",
    "This is a text plan for a video. No video file was produced.",
    "",
    `## Hook`,
    sb.hook,
    "",
    "## Script",
    ...sb.script.map((s) => `- ${s.start}–${s.end}s: ${s.line}`),
    "",
    "## Shots",
    ...sb.shots.flatMap((s) => [
      `### Shot ${s.shot} (${s.duration}s)`,
      `- Action: ${s.action}`,
      `- Camera: ${s.camera}`,
      `- On-screen text: ${s.onScreenText || "—"}`,
      `- Google Veo prompt: ${s.veoPrompt}`,
      `- Kling prompt: ${s.klingPrompt}`,
      "",
    ]),
    "## Caption",
    fullText(v),
    v.copy.title ? `\n## Title\n${v.copy.title}` : "",
  ].join("\n");
}

/**
 * Builds the scheduler package for approved posts in a date range: a ZIP with one folder per date and platform
 * (images, carousel slides in order, storyboards as Markdown), a Metricool bulk CSV and a generic CSV.
 * Only approved (or previously exported) posts are included; included posts are marked exported.
 */
export async function createExport(scope: BrandScope, brand: Brand, from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new ExportError("Choose a valid date range.");
  const posts = await scope.db
    .select()
    .from(masterPosts)
    .where(scope.where(masterPosts, and(gte(masterPosts.date, from), lte(masterPosts.date, to)), inArray(masterPosts.status, ["approved", "exported"])))
    .orderBy(masterPosts.date);
  if (!posts.length) throw new ExportError(`No approved posts between ${from} and ${to}.`);
  const variants = await scope.select(postVariants, inArray(postVariants.masterPostId, posts.map((p) => p.id)), inArray(postVariants.status, ["approved", "exported"]));
  const storage = getStorage();
  const zip = new JSZip();
  const root = zip.folder(`${slugify(brand.name)}_${from}_${to}`)!;
  const generic: (string | number)[][] = [];
  const metricool: (string | number | boolean)[][] = [];
  const mediaBase = (process.env.PUBLIC_MEDIA_BASE_URL ?? "").replace(/\/+$/, "");
  let fileCount = 0;
  const missing: string[] = [];

  for (const post of posts) {
    const pv = variants.filter((v) => v.masterPostId === post.id).sort((a, b) => a.platform.localeCompare(b.platform) || a.language.localeCompare(b.language));
    for (const v of pv) {
      const rules = platformRules(v.platform as Platform);
      const folder = `${post.date}/${folderName(v, brand.languages.length)}`;
      const files: string[] = [];
      let note = "";
      if (v.format === "video_storyboard") {
        const name = "storyboard.md";
        root.file(`${folder}/${name}`, storyboardMarkdown(v, post.date));
        files.push(name);
        note = "Storyboard — video not rendered";
      } else {
        const imgs = await variantImages(scope, v);
        if (!imgs.length) {
          missing.push(`${post.date} ${v.platform}/${v.language}`);
          continue;
        }
        for (const [i, a] of imgs.entries()) {
          const name = imgs.length > 1 ? `slide_${String(i + 1).padStart(2, "0")}.png` : `image.png`;
          root.file(`${folder}/${name}`, await storage.get(a.storageKey));
          files.push(name);
          fileCount++;
        }
      }
      root.file(`${folder}/caption.txt`, [v.copy.title ? `${v.copy.title}\n\n` : "", fullText(v)].join(""));
      const rel = files.map((f) => `${folder}/${f}`);
      generic.push([post.date, rules.defaultTime, v.platform, v.language, v.format, v.width, v.height, v.copy.caption, v.copy.hashtags.join(" "), fullText(v), v.copy.title ?? "", v.copy.cta, rel.join(" | "), folder, note]);
      if (v.format !== "video_storyboard") {
        const net = METRICOOL_NETWORKS[v.platform as Platform];
        const pics = rel.slice(0, 10).map((r) => (mediaBase ? `${mediaBase}/${encodeURI(r)}` : r));
        metricool.push([
          fullText(v),
          post.date,
          rules.defaultTime,
          "TRUE",
          ...NETWORK_COLUMNS.map((c) => (c === net ? "TRUE" : "FALSE")),
          ...Array.from({ length: 10 }, (_, i) => pics[i] ?? ""),
          net === "Instagram" ? (rel.length > 1 ? "CAROUSEL" : "POST") : "",
          net === "Facebook" ? "POST" : "",
          "",
          net === "LinkedIn" ? (v.format === "document_carousel" ? "DOCUMENT" : "POST") : "",
        ]);
      }
    }
  }
  if (missing.length) throw new ExportError(`Some approved variants have no rendered image: ${missing.join(", ")}. Re-render them first.`);

  root.file("posts_generic.csv", toCsv(GENERIC_HEADERS, generic));
  root.file("metricool_bulk_upload.csv", toCsv(METRICOOL_HEADERS, metricool));
  root.file(
    "README.txt",
    [
      `${brand.name}${brand.isTest ? " (TEST brand — synthetic data)" : ""}`,
      `Approved posts ${from} to ${to}: ${posts.length} posts, ${generic.length} platform variants, ${fileCount} images.`,
      "",
      "Folders: <date>/<platform>[_<language>]/ with image.png or slide_01.png, slide_02.png… in order, caption.txt, and storyboard.md for video posts.",
      "Storyboards are text plans: no video was rendered.",
      "",
      "metricool_bulk_upload.csv — Metricool bulk upload (one row per platform). Posts are imported as drafts (Draft = TRUE).",
      mediaBase ? `Picture URLs point to ${mediaBase}.` : "Picture Url columns hold paths inside this ZIP: host the folders and set PUBLIC_MEDIA_BASE_URL, or attach media in Metricool by hand.",
      "posts_generic.csv — every variant, for any other scheduler or a spreadsheet.",
      "Times are local posting times from config/platforms.json (defaultTime).",
    ].join("\n"),
  );

  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const key = brandKey(scope.brandId, "exports", `${slugify(brand.name)}_${from}_${to}.zip`);
  await storage.put(key, bytes);
  const [record] = await scope.insert(exportsTable, { fromDate: from, toDate: to, status: "completed", storageKey: key, postCount: posts.length, fileCount });
  await scope.update(masterPosts, { status: "exported", updatedAt: new Date() }, inArray(masterPosts.id, posts.map((p) => p.id)), eq(masterPosts.status, "approved"));
  await scope.update(postVariants, { status: "exported", updatedAt: new Date() }, inArray(postVariants.id, variants.map((v) => v.id)), eq(postVariants.status, "approved"));
  return { record, size: bytes.length, rows: generic.length };
}

export async function listExports(scope: BrandScope) {
  return (await scope.select(exportsTable)).sort((a, b) => +b.createdAt - +a.createdAt);
}
