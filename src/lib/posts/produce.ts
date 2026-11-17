import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { BrandScope } from "../brands/scope";
import {
  brands,
  masterPosts,
  planItems,
  postVariants,
  postVariantVersions,
  type CreativeReview,
  type Storyboard,
  type VariantCopy,
  type VariantVisual,
} from "../db/schema";
import { runRole } from "../ai/run";
import { brainForPrompt } from "../brand-brain/service";
import { entryText, type Section } from "../brand-brain/sections";
import { PLATFORMS, platformLabel, platformRules, variantSpec, type Platform, type PostFormat } from "../platforms";
import { LAYOUT_IDS, layoutsForPrompt } from "../render/layouts";
import { checkClaims } from "./claims";

type Brand = typeof brands.$inferSelect;
type PlanItem = typeof planItems.$inferSelect;
export type MasterPost = typeof masterPosts.$inferSelect;
export type Variant = typeof postVariants.$inferSelect;
export type Lang = "en" | "id";
const LANG_NAME: Record<Lang, string> = { en: "English", id: "Indonesian (Bahasa Indonesia)" };

export const STORYBOARD_LABEL = "Storyboard — video not rendered";
const CAROUSEL_FORMATS = new Set(["carousel", "photo_carousel", "document_carousel"]);

/** Variant targets for a plan item: one per active platform and language. */
export function variantTargets(brand: Brand, format: PostFormat) {
  const out: { platform: Platform; language: Lang; format: string; width: number; height: number; storyboard: boolean; slides?: [number, number] }[] = [];
  for (const language of brand.languages as Lang[])
    for (const platform of PLATFORMS.filter((p) => brand.platforms.includes(p))) {
      const spec = variantSpec(platform, format);
      const slides = CAROUSEL_FORMATS.has(spec.format) && (spec.maxSlides ?? 1) > 1 ? ([spec.minSlides ?? 3, spec.maxSlides ?? 10] as [number, number]) : undefined;
      out.push({ platform, language, format: spec.format, width: spec.width, height: spec.height, storyboard: spec.format === "video_storyboard", slides });
    }
  return out;
}

// ------------------------------------------------------------------ schemas

export const masterSchema = z.object({
  coreMessage: z.string().min(5).max(600),
  hooks: z.array(z.string().min(2).max(200)).length(3),
  visualConcept: z.string().min(5).max(800),
  cta: z.string().min(2).max(200),
  factIds: z.array(z.string()),
});

const copyItem = z.object({
  platform: z.enum(PLATFORMS),
  hook: z.string().min(1).max(300),
  caption: z.string().min(1).max(5000),
  hashtags: z.array(z.string()),
  cta: z.string().max(300),
  title: z.string().max(200),
  slides: z.array(z.object({ heading: z.string().max(120), body: z.string().max(400) })),
});

export function normaliseHashtags(tags: string[]) {
  const seen = new Set<string>();
  return tags
    .map((t) => "#" + t.trim().replace(/^#+/, "").replace(/\s+/g, ""))
    .filter((t) => t.length > 1 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

/** Copy schema for one language: platform limits from config/platforms.json are checked so the model retries on violations. */
export function copySchema(targets: ReturnType<typeof variantTargets>) {
  return z
    .object({ variants: z.array(copyItem) })
    .transform((v) => ({
      variants: v.variants.map((x) => {
        const r = platformRules(x.platform);
        return { ...x, hashtags: normaliseHashtags(x.hashtags).slice(0, r.hashtags.max) };
      }),
    }))
    .superRefine((v, ctx) => {
      for (const t of targets) {
        const x = v.variants.find((c) => c.platform === t.platform);
        if (!x) {
          ctx.addIssue({ code: "custom", message: `Missing variant for ${t.platform}` });
          continue;
        }
        const r = platformRules(t.platform);
        const fullLength = x.caption.length + (x.hashtags.length ? 1 + x.hashtags.join(" ").length : 0);
        if (t.platform === "x_threads" ? fullLength > r.caption.maxChars : x.caption.length > r.caption.maxChars)
          ctx.addIssue({ code: "custom", message: `${t.platform}: caption${t.platform === "x_threads" ? " plus hashtags" : ""} is ${fullLength} characters, limit ${r.caption.maxChars}` });
        if (x.hashtags.length < r.hashtags.min) ctx.addIssue({ code: "custom", message: `${t.platform}: needs at least ${r.hashtags.min} hashtags` });
        if (r.title && (!x.title || x.title.length > r.title.maxChars)) ctx.addIssue({ code: "custom", message: `${t.platform}: title required, max ${r.title.maxChars} characters` });
        if (t.slides && (x.slides.length < t.slides[0] || x.slides.length > t.slides[1]))
          ctx.addIssue({ code: "custom", message: `${t.platform}: needs ${t.slides[0]}–${t.slides[1]} slides, got ${x.slides.length}` });
      }
    });
}

export const visualSchema = z.object({
  variants: z.array(
    z.object({
      platform: z.enum(PLATFORMS),
      imagePrompt: z.string().min(10).max(2000),
      layout: z.enum(LAYOUT_IDS as [string, ...string[]]),
      headline: z.string().min(1).max(120),
      subtext: z.string().max(200),
      textPlacement: z.enum(["top", "center", "bottom"]),
    }),
  ),
});

export const storyboardSchema = z.object({
  hook: z.string().min(1).max(300),
  script: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), line: z.string().min(1).max(500) })).min(1),
  shots: z
    .array(
      z.object({
        shot: z.number().int(),
        action: z.string().min(1),
        camera: z.string().min(1),
        onScreenText: z.string(),
        duration: z.number().min(0.5).max(20),
        veoPrompt: z.string().min(10),
        klingPrompt: z.string().min(10),
      }),
    )
    .min(4)
    .max(8),
});

const score = z.number().int().min(1).max(5);
export const reviewSchema = z.object({
  scores: z.object({ brandFit: score, platformFit: score, clarity: score, hookStrength: score, claimSafety: score }),
  reasons: z.object({ brandFit: z.string(), platformFit: z.string(), clarity: z.string(), hookStrength: z.string(), claimSafety: z.string() }),
  flaggedClaims: z.array(z.object({ claim: z.string(), reason: z.string(), variant: z.string() })),
});

// ------------------------------------------------------------------ helpers

type Ctx = { scope: BrandScope; brand: Brand; jobId?: string | null };
type BrainCtx = Awaited<ReturnType<typeof brainForPrompt>>;

function sectionText(brain: BrainCtx, section: Section) {
  return (
    brain.entries
      .filter((e) => e.section === section)
      .map((e) => entryText(section, e.data))
      .join("\n") || "(none)"
  );
}

function rulesText(targets: ReturnType<typeof variantTargets>) {
  return targets
    .map((t) => {
      const r = platformRules(t.platform);
      return `- ${t.platform} (${r.label}, ${t.format} ${t.width}×${t.height}): ${r.style} Caption max ${r.caption.maxChars} characters (aim for ~${r.caption.recommendedChars}). Hashtags ${r.hashtags.min}–${r.hashtags.max}.${r.title ? ` Title max ${r.title.maxChars} characters.` : ""}${t.slides ? ` Slides: ${t.slides[0]}–${t.slides[1]}.` : ""}`;
    })
    .join("\n");
}

async function snapshotVariant(scope: BrandScope, v: Variant, reason: string, instruction?: string | null, assetIds: string[] = []) {
  await scope.insert(postVariantVersions, { variantId: v.id, version: v.version, copy: v.copy, visual: v.visual, storyboard: v.storyboard, reason, instruction: instruction ?? null, assetIds });
}

export async function postVariantsOf(scope: BrandScope, masterId: string) {
  return scope.db
    .select()
    .from(postVariants)
    .where(scope.where(postVariants, eq(postVariants.masterPostId, masterId)))
    .orderBy(asc(postVariants.language), asc(postVariants.platform));
}

// ------------------------------------------------------------------ the team

async function makeMaster(ctx: Ctx, item: PlanItem, brain: BrainCtx) {
  const out = await runRole({
    scope: ctx.scope,
    jobId: ctx.jobId,
    role: "copywriter",
    prompt: "master_post",
    vars: { brand_name: ctx.brand.name, brain: brain.text, date: item.date, pillar: item.pillar, format: item.format, angle: item.angle, goal: item.goal },
    schema: masterSchema,
    mock: () => mockMaster(item, brain),
  });
  const validIds = new Set(brain.entries.map((e) => e.id));
  const [m] = await ctx.scope.insert(masterPosts, {
    planItemId: item.id,
    date: item.date,
    format: item.format,
    pillar: item.pillar,
    coreMessage: out.coreMessage,
    hooks: out.hooks,
    visualConcept: out.visualConcept,
    cta: out.cta,
    factIds: out.factIds.filter((id) => validIds.has(id)),
    status: "concept",
    imageSource: ctx.brand.imageSource,
  });
  return m;
}

export async function writeCopy(ctx: Ctx, master: MasterPost, language: Lang, targets: ReturnType<typeof variantTargets>, brain: BrainCtx, instruction?: string) {
  const out = await runRole({
    scope: ctx.scope,
    jobId: ctx.jobId,
    role: "copywriter",
    prompt: "copywriter",
    vars: {
      brand_name: ctx.brand.name,
      language_name: LANG_NAME[language],
      voice: sectionText(brain, "voice"),
      brain: brain.text,
      platform_rules: rulesText(targets),
      pillar: master.pillar,
      format: master.format,
      core_message: master.coreMessage,
      hooks: master.hooks.join(" | "),
      visual_concept: master.visualConcept,
      cta: master.cta + (instruction ? `\n\nOperator instruction for this rewrite: ${instruction}` : ""),
      platforms: targets.map((t) => t.platform).join(", "),
      slides_instruction: targets.some((t) => t.slides)
        ? `for ${targets
            .filter((t) => t.slides)
            .map((t) => `${t.platform} (${t.slides![0]}–${t.slides![1]} slides)`)
            .join(", ")}: the carousel slides in order, each {heading, body}; slide 1 is the cover. For other platforms an empty list.`
        : "an empty list for every platform.",
    },
    schema: copySchema(targets),
    mock: () => mockCopy(master, language, targets),
  });
  return out.variants;
}

export async function directVisuals(ctx: Ctx, master: MasterPost, variants: { platform: Platform; language: string; format: string; width: number; height: number; hook: string }[], brain: BrainCtx, instruction?: string) {
  const out = await runRole({
    scope: ctx.scope,
    jobId: ctx.jobId,
    role: "visual_director",
    prompt: "visual_director",
    vars: {
      brand_name: ctx.brand.name,
      visual: sectionText(brain, "visual"),
      layouts: layoutsForPrompt(),
      brain: brain.text,
      format: master.format,
      core_message: master.coreMessage,
      visual_concept: master.visualConcept + (instruction ? `\nOperator instruction: ${instruction}` : ""),
      variants: variants.map((v) => `- ${v.platform}: ${v.format} ${v.width}×${v.height}, copy language ${v.language}, hook: "${v.hook}"`).join("\n"),
    },
    schema: visualSchema,
    mock: () => mockVisual(master, variants),
  });
  return out.variants;
}

async function produceStoryboard(ctx: Ctx, master: MasterPost, language: Lang, brain: BrainCtx, instruction?: string): Promise<Storyboard> {
  const out = await runRole({
    scope: ctx.scope,
    jobId: ctx.jobId,
    role: "video_producer",
    prompt: "video_producer",
    vars: {
      brand_name: ctx.brand.name,
      language_name: LANG_NAME[language],
      voice: sectionText(brain, "voice"),
      visual: sectionText(brain, "visual"),
      brain: brain.text,
      pillar: master.pillar,
      core_message: master.coreMessage,
      hooks: master.hooks.join(" | "),
      visual_concept: master.visualConcept,
      cta: master.cta + (instruction ? `\nOperator instruction: ${instruction}` : ""),
    },
    schema: storyboardSchema,
    mock: () => mockStoryboard(master),
  });
  return { label: STORYBOARD_LABEL, ...out, shots: out.shots.map((s, i) => ({ ...s, shot: i + 1 })) };
}

/** Text of a variant used for claim checks and the Creative Director. */
export function variantText(v: Pick<Variant, "copy" | "visual" | "storyboard">) {
  const parts = [v.copy.hook, v.copy.caption, v.copy.cta, v.copy.title ?? "", ...(v.copy.slides ?? []).flatMap((s) => [s.heading, s.body])];
  if (v.visual) parts.push(v.visual.headline, v.visual.subtext ?? "");
  if (v.storyboard) parts.push(v.storyboard.hook, ...v.storyboard.script.map((s) => s.line), ...v.storyboard.shots.map((s) => s.onScreenText));
  return parts.filter(Boolean).join("\n");
}

/** Creative Director review + rule-based claim guard. Stored on the master post. */
export async function reviewPost(ctx: Ctx, master: MasterPost, brain?: BrainCtx): Promise<CreativeReview> {
  brain ??= await brainForPrompt(ctx.scope, { focus: master.coreMessage });
  const variants = await postVariantsOf(ctx.scope, master.id);
  const ai = await runRole({
    scope: ctx.scope,
    jobId: ctx.jobId,
    role: "creative_director",
    prompt: "creative_director",
    vars: {
      brand_name: ctx.brand.name,
      brain: brain.text,
      date: master.date,
      format: master.format,
      pillar: master.pillar,
      core_message: master.coreMessage,
      variants: variants.map((v) => `### ${v.platform} (${v.language})\n${variantText(v)}\nHashtags: ${v.copy.hashtags.join(" ")}`).join("\n\n"),
    },
    schema: reviewSchema,
    mock: () => ({
      scores: { brandFit: 4, platformFit: 4, clarity: 4, hookStrength: 3, claimSafety: 5 },
      reasons: { brandFit: "[TEST] Uses the brand voice.", platformFit: "[TEST] Each platform has its own copy.", clarity: "[TEST] One message.", hookStrength: "[TEST] Hook is clear but could be sharper.", claimSafety: "[TEST] Rule-based claim check applied." },
      flaggedClaims: [],
    }),
  });
  const factsText = brain.entries
    .filter((e) => e.section !== "claim_forbidden")
    .map((e) => `${e.title}\n${entryText(e.section as Section, e.data)}`)
    .join("\n");
  const forbidden = brain.entries.filter((e) => e.section === "claim_forbidden").map((e) => String(e.data.claim));
  const texts = Object.fromEntries([["master", `${master.coreMessage}\n${master.hooks.join("\n")}\n${master.cta}`], ...variants.map((v) => [`${v.platform}/${v.language}`, variantText(v)])]);
  const guard = checkClaims(texts, factsText, forbidden);
  const flagged = [...ai.flaggedClaims, ...guard.filter((g) => !ai.flaggedClaims.some((a) => a.claim.trim() === g.claim.trim()))];
  const review: CreativeReview = {
    scores: { ...ai.scores, claimSafety: flagged.length ? Math.min(ai.scores.claimSafety, flagged.some((f) => /do-not-say/.test(f.reason)) ? 1 : 2) : ai.scores.claimSafety },
    reasons: { ...ai.reasons, ...(flagged.length && !ai.flaggedClaims.length ? { claimSafety: `${flagged.length} claim(s) not backed by the approved Brand Brain.` } : {}) },
    flaggedClaims: flagged,
    reviewedAt: new Date().toISOString(),
  };
  await ctx.scope.update(masterPosts, { review, updatedAt: new Date() }, eq(masterPosts.id, master.id));
  return review;
}

/**
 * Produces one post: master, copy for every platform and language, visual direction, storyboard and the
 * Creative Director review. Every finished piece is saved before the next one starts, so a re-run continues
 * where it stopped and never creates duplicates.
 */
export async function producePost(ctx: Ctx, item: PlanItem) {
  const { scope, brand } = ctx;
  const brain = await brainForPrompt(scope, { focus: `${item.pillar} ${item.angle}` });
  let [master] = await scope.select(masterPosts, eq(masterPosts.planItemId, item.id));
  if (!master) master = await makeMaster(ctx, item, brain);

  const targets = variantTargets(brand, item.format as PostFormat);
  let existing = await postVariantsOf(scope, master.id);
  for (const language of brand.languages as Lang[]) {
    const missing = targets.filter((t) => t.language === language && !existing.some((v) => v.platform === t.platform && v.language === language));
    if (!missing.length) continue;
    const copies = await writeCopy(ctx, master, language, missing, brain);
    for (const t of missing) {
      const c = copies.find((x) => x.platform === t.platform)!;
      const copy: VariantCopy = { hook: c.hook, caption: c.caption, hashtags: c.hashtags, cta: c.cta, ...(c.title ? { title: c.title } : {}), ...(t.slides ? { slides: c.slides } : {}) };
      const [v] = await scope.insert(postVariants, { masterPostId: master.id, platform: t.platform, language, format: t.format, width: t.width, height: t.height, copy, status: "draft" });
      await snapshotVariant(scope, v, "generated");
    }
  }
  existing = await postVariantsOf(scope, master.id);

  const needVisual = existing.filter((v) => v.format !== "video_storyboard" && !v.visual);
  if (needVisual.length) {
    const visuals = await directVisuals(
      ctx,
      master,
      needVisual.map((v) => ({ platform: v.platform as Platform, language: v.language, format: v.format, width: v.width, height: v.height, hook: v.copy.hook })),
      brain,
    );
    for (const v of needVisual) {
      const vis = visuals.find((x) => x.platform === v.platform) ?? visuals[0];
      if (!vis) continue;
      const visual: VariantVisual = { ...vis, layout: CAROUSEL_FORMATS.has(v.format) && (v.copy.slides?.length ?? 0) > 1 ? "carousel" : vis.layout === "carousel" ? "bold_headline" : vis.layout, textPlacement: vis.textPlacement };
      await scope.update(postVariants, { visual, updatedAt: new Date() }, eq(postVariants.id, v.id));
    }
  }

  for (const language of brand.languages as Lang[]) {
    const needBoard = existing.filter((v) => v.language === language && v.format === "video_storyboard" && !v.storyboard);
    if (!needBoard.length) continue;
    const board = await produceStoryboard(ctx, master, language, brain);
    await scope.update(postVariants, { storyboard: board, updatedAt: new Date() }, inArray(postVariants.id, needBoard.map((v) => v.id)));
  }

  [master] = await scope.select(masterPosts, eq(masterPosts.id, master.id));
  if (!master.review) await reviewPost(ctx, master, brain);
  if (master.status === "concept") await scope.update(masterPosts, { status: "draft", updatedAt: new Date() }, eq(masterPosts.id, master.id));
  const [done] = await scope.select(masterPosts, eq(masterPosts.id, master.id));
  return done;
}

// ------------------------------------------------------------------ estimates

export const TEXT_CALL_COST_USD = 0.09;

/** Estimated AI calls, image generations and cost for producing these plan items (shown before the operator confirms). */
export function estimateBatch(brand: Brand, items: Pick<PlanItem, "format">[], opts: { imagesEnabled: boolean; costPerImage: number; alreadyDone?: number }) {
  let aiCalls = 0;
  let images = 0;
  const L = brand.languages.length;
  for (const item of items) {
    const targets = variantTargets(brand, item.format as PostFormat);
    const hasImage = targets.some((t) => !t.storyboard);
    const hasBoard = targets.some((t) => t.storyboard);
    aiCalls += 1 + L + (hasImage ? 1 : 0) + (hasBoard ? L : 0) + 1;
    if (opts.imagesEnabled && brand.imageSource === "generated") images += new Set(targets.filter((t) => !t.storyboard).map((t) => `${t.width}x${t.height}`)).size;
  }
  const cost = aiCalls * TEXT_CALL_COST_USD + images * opts.costPerImage;
  const notes = [
    `${items.length} post(s) × ${brand.platforms.length} platform(s) × ${L} language(s)`,
    `About ${TEXT_CALL_COST_USD.toFixed(2)} USD per AI call (model ${process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5"}), ${opts.costPerImage.toFixed(3)} USD per generated image`,
  ];
  if (!opts.imagesEnabled) notes.push("Image provider not connected: layouts will be rendered on approved brand photos or plain brand colour; no image cost.");
  if (opts.alreadyDone) notes.push(`${opts.alreadyDone} post(s) already produced are skipped.`);
  return { aiCalls, imageGenerations: images, estimatedCostUsd: Math.round(cost * 100) / 100, notes };
}

// ------------------------------------------------------------------ TEST-mode mocks

function mockMaster(item: PlanItem, brain: BrainCtx): z.infer<typeof masterSchema> {
  const product = brain.entries.find((e) => e.section === "product");
  return {
    coreMessage: `[TEST] ${item.angle.replace(/^\[TEST\]\s*/, "")}`,
    hooks: [`[TEST] ${product?.title ?? item.pillar}, up close`, `[TEST] What goes into ${product?.title ?? "it"}?`, `[TEST] ${item.pillar}: one thing to know`],
    visualConcept: `[TEST] ${product?.title ?? "The product"} on a simple surface in natural light, space at the top for text.`,
    cta: item.goal === "leads" ? "[TEST] Send us a message to order" : "[TEST] Save this for later",
    factIds: product ? [product.id] : [],
  };
}

function mockCopy(master: MasterPost, language: Lang, targets: ReturnType<typeof variantTargets>) {
  const tag = language === "id" ? "[TEST ID]" : "[TEST]";
  return {
    variants: targets.map((t) => {
      const r = platformRules(t.platform);
      const n = Math.max(r.hashtags.min, Math.min(r.hashtags.max, 3));
      const hook = `${tag} ${master.hooks[PLATFORMS.indexOf(t.platform) % 3]}`.slice(0, 120);
      const caption = t.platform === "x_threads" ? `${hook}`.slice(0, 200) : `${hook}\n\n${master.coreMessage}\n\n${master.cta}`;
      return {
        platform: t.platform,
        hook,
        caption,
        hashtags: Array.from({ length: n }, (_, i) => `#test${platformLabel(t.platform).replace(/\W/g, "")}${i + 1}`),
        cta: master.cta,
        title: r.title ? `${tag} ${master.pillar}`.slice(0, 60) : "",
        slides: t.slides ? Array.from({ length: Math.max(t.slides[0], 4) }, (_, i) => ({ heading: i === 0 ? hook.slice(0, 60) : `${tag} Point ${i}`, body: i === 0 ? master.coreMessage.slice(0, 120) : `${tag} Supporting detail ${i}.` })) : [],
      };
    }),
  };
}

function mockVisual(master: MasterPost, variants: { platform: Platform; format: string; hook: string }[]) {
  const layouts = ["bold_headline", "quote", "product_showcase", "list_tips", "before_after"];
  return {
    variants: variants.map((v, i) => ({
      platform: v.platform,
      imagePrompt: `[TEST] ${master.visualConcept} No text, no letters, no logos.`,
      layout: CAROUSEL_FORMATS.has(v.format) ? "carousel" : layouts[(i + master.date.charCodeAt(9)) % layouts.length],
      headline: v.hook.replace(/\[TEST( ID)?\]\s*/g, "").slice(0, 60),
      subtext: "[TEST] Synthetic layout",
      textPlacement: (["top", "center", "bottom"] as const)[i % 3],
    })),
  };
}

function mockStoryboard(master: MasterPost): z.infer<typeof storyboardSchema> {
  return {
    hook: `[TEST] ${master.hooks[0]}`,
    script: [
      { start: 0, end: 2, line: `[TEST] ${master.hooks[0]}` },
      { start: 2, end: 12, line: `[TEST] ${master.coreMessage}` },
      { start: 12, end: 15, line: `[TEST] ${master.cta}` },
    ],
    shots: [1, 2, 3, 4].map((n) => ({
      shot: n,
      action: `[TEST] Shot ${n}: ${master.visualConcept}`,
      camera: n === 1 ? "Close-up, slow push in" : "Medium shot, handheld",
      onScreenText: n === 1 ? master.hooks[0] : n === 4 ? master.cta : "",
      duration: n === 2 ? 6 : 3,
      veoPrompt: `[TEST] ${master.visualConcept} Vertical 9:16, natural light, no text overlays.`,
      klingPrompt: `[TEST] ${master.visualConcept}, 9:16`,
    })),
  };
}

