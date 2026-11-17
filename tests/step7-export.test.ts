import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { closeDb } from "@/lib/db";
import { exportsTable, masterPosts, postVariants } from "@/lib/db/schema";
import { approvePlan, generatePlan, getPlan } from "@/lib/plans/service";
import { producePost } from "@/lib/posts/produce";
import { approvePost } from "@/lib/posts/review";
import { closeBrowser, renderPost } from "@/lib/render/render";
import { setImageProvider } from "@/lib/render/image-provider";
import { createExport, ExportError, GENERIC_HEADERS, listExports, METRICOOL_HEADERS, toCsv } from "@/lib/export/export";
import { getStorage } from "@/lib/storage";
import { truncateAll } from "./helpers";
import { makeReadyBrand } from "./brain-fixture";

process.env.NOVRA_INLINE_JOBS = "1";
beforeAll(() => setImageProvider(null));
beforeEach(truncateAll);
afterAll(async () => {
  setImageProvider(undefined);
  await closeBrowser();
  await closeDb();
});

/** Minimal RFC 4180 parser for the tests (quoted fields, CRLF). */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\r" && s[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      (row = []), (field = ""), i++;
    } else field += c;
  }
  return rows;
}

async function brandWithPosts(tag = "Kopi", languages: ("id" | "en")[] = ["id", "en"]) {
  const r = await makeReadyBrand({ name: `${tag} TEST brand`, languages }, tag);
  const plan = await generatePlan(r.scope, r.brand, { startDate: "2026-12-01", postsCount: 30 });
  await approvePlan(r.scope, plan.id);
  const { items } = await getPlan(r.scope, plan.id);
  const made: Record<string, string> = {};
  for (const format of ["single_image", "carousel", "short_video"] as const) {
    const item = items.find((i) => i.format === format)!;
    const m = await producePost({ scope: r.scope, brand: r.brand }, item);
    await renderPost(r.scope, r.brand, m.id, null);
    made[format] = m.id;
  }
  return { ...r, made };
}

describe("export", () => {
  it("toCsv quotes every field, escapes quotes, adds a BOM and CRLF", () => {
    const csv = toCsv(["a", "b"], [['say "hi"', "line1\nline2"], [1, null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe('﻿"a","b"\r\n"say ""hi""","line1\nline2"\r\n"1",""\r\n');
    expect(parseCsv(csv)).toEqual([["a", "b"], ['say "hi"', "line1\nline2"], ["1", ""]]);
  });

  it("refuses an empty range or one with nothing approved", async () => {
    const { scope, brand } = await brandWithPosts();
    await expect(createExport(scope, brand, "2026-12-31", "2026-12-01")).rejects.toThrow(ExportError);
    await expect(createExport(scope, brand, "2026-12-01", "2026-12-31")).rejects.toThrow(/No approved posts/);
  });

  it("builds the ZIP, both CSVs and README for approved posts only, then marks them exported", async () => {
    const { scope, brand, made } = await brandWithPosts();
    await approvePost(scope, made.carousel);
    await approvePost(scope, made.short_video);
    // single_image stays unapproved and must not be exported

    const { record, rows } = await createExport(scope, brand, "2026-12-01", "2026-12-31");
    expect(record.postCount).toBe(2);
    const zip = await JSZip.loadAsync(await getStorage().get(record.storageKey!));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const root = names[0].split("/")[0];
    expect(root).toBe("kopi-test-brand_2026-12-01_2026-12-31");

    const [carousel] = await scope.select(masterPosts, eq(masterPosts.id, made.carousel));
    const [video] = await scope.select(masterPosts, eq(masterPosts.id, made.short_video));
    const [single] = await scope.select(masterPosts, eq(masterPosts.id, made.single_image));
    expect(carousel.status).toBe("exported");
    expect(video.status).toBe("exported");
    expect(single.status).not.toBe("exported");

    // carousel slides are numbered in order, one folder per platform and language
    const igSlides = names.filter((n) => n.startsWith(`${root}/${carousel.date}/instagram_id/slide_`)).sort();
    expect(igSlides.length).toBeGreaterThan(1);
    igSlides.forEach((n, i) => expect(n.endsWith(`slide_${String(i + 1).padStart(2, "0")}.png`)).toBe(true));
    const png = await zip.file(igSlides[0])!.async("uint8array");
    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(names).toContain(`${root}/${carousel.date}/instagram_en/caption.txt`);

    // video posts come out as storyboard text, never as a video file
    const sb = names.filter((n) => n.startsWith(`${root}/${video.date}/`) && n.endsWith("storyboard.md"));
    expect(sb.length).toBeGreaterThan(0);
    expect(names.some((n) => /\.(mp4|mov|webm)$/.test(n))).toBe(false);
    expect(await zip.file(sb[0])!.async("string")).toContain("No video file was produced");
    expect(names.some((n) => n.startsWith(`${root}/${single.date}/`) && single.date !== carousel.date && single.date !== video.date)).toBe(false);

    // generic CSV: one row per exported variant
    const generic = parseCsv(await zip.file(`${root}/posts_generic.csv`)!.async("string"));
    expect(generic[0]).toEqual(GENERIC_HEADERS);
    expect(generic.length - 1).toBe(rows);
    const variants = await scope.select(postVariants);
    const exportedVariants = variants.filter((v) => v.masterPostId !== made.single_image);
    expect(rows).toBe(exportedVariants.length);
    expect(exportedVariants.every((v) => v.status === "exported")).toBe(true);
    const col = (h: string) => GENERIC_HEADERS.indexOf(h);
    for (const r of generic.slice(1)) {
      expect(r).toHaveLength(GENERIC_HEADERS.length);
      for (const f of r[col("file_names")].split(" | ")) expect(names).toContain(`${root}/${f}`);
    }
    expect(generic.slice(1).some((r) => r[col("format")] === "video_storyboard" && r[col("note")].includes("video not rendered"))).toBe(true);

    // Metricool CSV: image variants only, one network per row, drafts, slides in order
    const met = parseCsv(await zip.file(`${root}/metricool_bulk_upload.csv`)!.async("string"));
    expect(met[0]).toEqual(METRICOOL_HEADERS);
    const m = (h: string) => METRICOOL_HEADERS.indexOf(h);
    const imageVariants = exportedVariants.filter((v) => v.format !== "video_storyboard");
    expect(met.length - 1).toBe(imageVariants.length);
    for (const r of met.slice(1)) {
      expect(r).toHaveLength(METRICOOL_HEADERS.length);
      expect(r[m("Draft")]).toBe("TRUE");
      expect(r[m("Date")]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r[m("Time")]).toMatch(/^\d{2}:\d{2}$/);
      const nets = ["Facebook", "Twitter", "LinkedIn", "GMB", "Instagram", "Pinterest", "TikTok", "Youtube", "Threads", "Bluesky"].filter((n) => r[m(n)] === "TRUE");
      expect(nets).toHaveLength(1);
      expect(r[m("Picture Url 1")]).not.toBe("");
    }
    const igRow = met.slice(1).find((r) => r[m("Instagram")] === "TRUE" && r[m("Picture Url 2")])!;
    expect(igRow[m("Instagram Post Type")]).toBe("CAROUSEL");
    expect(igRow[m("Picture Url 1")]).toMatch(/slide_01\.png$/);
    expect(igRow[m("Picture Url 2")]).toMatch(/slide_02\.png$/);

    const readme = await zip.file(`${root}/README.txt`)!.async("string");
    expect(readme).toContain("TEST brand");
    expect(readme).toContain("no video was rendered");

    expect((await listExports(scope)).map((e) => e.id)).toEqual([record.id]);
  });

  it("uses PUBLIC_MEDIA_BASE_URL for picture URLs when set", async () => {
    const { scope, brand, made } = await brandWithPosts("Teh", ["en"]);
    await approvePost(scope, made.single_image);
    process.env.PUBLIC_MEDIA_BASE_URL = "https://media.example.test/novra/";
    try {
      const { record } = await createExport(scope, brand, "2026-12-01", "2026-12-31");
      const zip = await JSZip.loadAsync(await getStorage().get(record.storageKey!));
      const csvName = Object.keys(zip.files).find((n) => n.endsWith("metricool_bulk_upload.csv"))!;
      const met = parseCsv(await zip.file(csvName)!.async("string"));
      const url = met[1][METRICOOL_HEADERS.indexOf("Picture Url 1")];
      expect(url).toMatch(/^https:\/\/media\.example\.test\/novra\/\d{4}-\d{2}-\d{2}\/[a-z_]+\/image\.png$/);
    } finally {
      delete process.env.PUBLIC_MEDIA_BASE_URL;
    }
  });

  it("keeps brands apart: one brand's export holds none of another brand's posts", async () => {
    const a = await brandWithPosts("Kopi");
    const b = await brandWithPosts("Teh");
    await approvePost(a.scope, a.made.carousel);
    await approvePost(b.scope, b.made.single_image);
    const ea = await createExport(a.scope, a.brand, "2026-12-01", "2026-12-31");
    expect(ea.record.postCount).toBe(1);
    expect(ea.record.storageKey).toContain(`brands/${a.brand.id}/`);
    const zip = await JSZip.loadAsync(await getStorage().get(ea.record.storageKey!));
    const text = (await Promise.all(Object.values(zip.files).filter((f) => !f.dir && /\.(csv|txt|md)$/.test(f.name)).map((f) => f.async("string")))).join("\n");
    expect(text).not.toMatch(/Teh/);
    expect(await listExports(b.scope)).toHaveLength(0);
    await expect(b.scope.get(exportsTable, ea.record.id)).rejects.toThrow();
    const [bPost] = await b.scope.select(masterPosts, eq(masterPosts.id, b.made.single_image));
    expect(bPost.status).toBe("approved");
  });
});
