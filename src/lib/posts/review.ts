import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import type { BrandScope } from "../brands/scope";
import { assets, brands, masterPosts, postVariants, postVariantVersions, reviewEvents, type CreativeReview, type VariantCopy } from "../db/schema";
import { brainForPrompt } from "../brand-brain/service";
import { entryText, type Section } from "../brand-brain/sections";
import { createJob } from "../jobs/service";
import { platformRules, type Platform } from "../platforms";
import { checkClaims } from "./claims";
import { directVisuals, normaliseHashtags, postVariantsOf, TEXT_CALL_COST_USD, variantTargets, variantText, writeCopy, type Lang, type Variant } from "./produce";
import { brandKit, renderVariant } from "../render/render";
import { imageProviderStatus } from "../render/image-provider";
import type { PostFormat } from "../platforms";

type Brand = typeof brands.$inferSelect;
export class ReviewError extends Error {}

async function logEvent(scope: BrandScope, e: { masterPostId: string; variantId?: string | null; userId?: string | null; action: string; reason?: string | null }) {
  await scope.insert(reviewEvents, { masterPostId: e.masterPostId, variantId: e.variantId ?? null, userId: e.userId ?? null, action: e.action, reason: e.reason ?? null });
}

/** Saves a new version of a variant. Old versions (copy, visual, images) stay viewable. */
async function newVersion(scope: BrandScope, v: Variant, patch: Partial<Pick<Variant, "copy" | "visual" | "storyboard">>, reason: string, instruction?: string | null) {
  const [updated] = await scope.update(
    postVariants,
    { ...patch, version: v.version + 1, status: "draft", renderError: null, updatedAt: new Date() },
    eq(postVariants.id, v.id),
    eq(postVariants.version, v.version),
  );
  if (!updated) throw new ReviewError("This variant was changed meanwhile. Reload and try again.");
  await scope.insert(postVariantVersions, { variantId: v.id, version: updated.version, copy: updated.copy, visual: updated.visual, storyboard: updated.storyboard, reason, instruction: instruction ?? null, assetIds: [] });
  // the post goes back to review
  const master = await scope.get(masterPosts, v.masterPostId);
  if (["approved", "rendered", "rejected"].includes(master.status)) await scope.update(masterPosts, { status: "draft", updatedAt: new Date() }, eq(masterPosts.id, master.id));
  return updated;
}

export const editSchema = z.object({
  hook: z.string().trim().min(1).max(300),
  caption: z.string().trim().min(1).max(5000),
  hashtags: z.string().max(2000),
  cta: z.string().trim().max(300),
  title: z.string().trim().max(200).optional(),
  headline: z.string().trim().max(120).optional(),
  subtext: z.string().trim().max(200).optional(),
  slides: z.string().max(10000).optional(),
});

/** Inline edit of copy/headline/slides by the operator. Creates a new version and re-checks claims (no AI cost). */
export async function editVariant(scope: BrandScope, brand: Brand, variantId: string, input: z.input<typeof editSchema>, userId?: string) {
  const v = await scope.get(postVariants, variantId);
  const d = editSchema.parse(input);
  const rules = platformRules(v.platform as Platform);
  const hashtags = normaliseHashtags(d.hashtags.split(/[\s,]+/).filter(Boolean));
  if (hashtags.length > rules.hashtags.max) throw new ReviewError(`${rules.label} allows at most ${rules.hashtags.max} hashtags.`);
  const full = v.platform === "x_threads" ? d.caption.length + (hashtags.length ? 1 + hashtags.join(" ").length : 0) : d.caption.length;
  if (full > rules.caption.maxChars) throw new ReviewError(`${rules.label} caption is ${full} characters; the limit is ${rules.caption.maxChars}.`);
  if (rules.title && d.title !== undefined && d.title.length > rules.title.maxChars) throw new ReviewError(`Title must be under ${rules.title.maxChars} characters.`);
  const slides = d.slides !== undefined && v.copy.slides ? parseSlides(d.slides) : v.copy.slides;
  if (slides && v.copy.slides && slides.length < 1) throw new ReviewError("A carousel needs at least one slide.");
  const copy: VariantCopy = { ...v.copy, hook: d.hook, caption: d.caption, hashtags, cta: d.cta, ...(d.title !== undefined && rules.title ? { title: d.title } : {}), ...(slides ? { slides } : {}) };
  const visual = v.visual ? { ...v.visual, headline: d.headline ?? v.visual.headline, subtext: d.subtext ?? v.visual.subtext } : v.visual;
  const updated = await newVersion(scope, v, { copy, visual }, "edit");
  await logEvent(scope, { masterPostId: v.masterPostId, variantId, userId, action: "edit" });
  await recheckClaims(scope, v.masterPostId);
  if (updated.format !== "video_storyboard") await queueRender(scope, [v.masterPostId]);
  return updated;
}

/** Slides textarea: one slide per block, "Heading" on the first line, body below; blocks separated by a line with ---. */
export function parseSlides(text: string) {
  return text
    .split(/\n\s*---\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const [heading, ...body] = b.split("\n");
      return { heading: heading.trim().slice(0, 120), body: body.join("\n").trim().slice(0, 400) };
    });
}
export const slidesToText = (slides?: { heading: string; body: string }[]) => (slides ?? []).map((s) => `${s.heading}\n${s.body}`).join("\n---\n");

export async function queueRender(scope: BrandScope, masterPostIds: string[]) {
  return createJob(scope, "render_variants", { masterPostIds }, { autoStart: true, estimate: { aiCalls: 0, imageGenerations: 0, estimatedCostUsd: 0, notes: ["Re-render layouts"] } });
}

/** Rule-based claim check after a manual edit; keeps the Creative Director's scores and AI flags for unchanged text. */
export async function recheckClaims(scope: BrandScope, masterId: string) {
  const master = await scope.get(masterPosts, masterId);
  const brain = await brainForPrompt(scope);
  const variants = await postVariantsOf(scope, masterId);
  const facts = brain.entries
    .filter((e) => e.section !== "claim_forbidden")
    .map((e) => `${e.title}\n${entryText(e.section as Section, e.data)}`)
    .join("\n");
  const forbidden = brain.entries.filter((e) => e.section === "claim_forbidden").map((e) => String(e.data.claim));
  const texts = Object.fromEntries([["master", `${master.coreMessage}\n${master.hooks.join("\n")}\n${master.cta}`], ...variants.map((v) => [`${v.platform}/${v.language}`, variantText(v)])]);
  const guard = checkClaims(texts, facts, forbidden);
  const allText = Object.values(texts).join("\n");
  const prev = master.review;
  const aiFlags = (prev?.flaggedClaims ?? []).filter((f) => allText.includes(f.claim.trim()) && !/Brand Brain fact \(|do-not-say claim:/.test(f.reason));
  const flags = [...aiFlags, ...guard.filter((g) => !aiFlags.some((a) => a.claim.trim() === g.claim.trim()))];
  const review: CreativeReview = {
    scores: { ...(prev?.scores ?? { brandFit: 3, platformFit: 3, clarity: 3, hookStrength: 3, claimSafety: 5 }), claimSafety: flags.length ? (flags.some((f) => /do-not-say/.test(f.reason)) ? 1 : 2) : Math.max(prev?.scores.claimSafety ?? 4, 4) },
    reasons: { ...(prev?.reasons ?? {}), claimSafety: flags.length ? `${flags.length} claim(s) not backed by the approved Brand Brain (re-checked after edit).` : "No unsupported claims found (re-checked after edit)." },
    flaggedClaims: flags,
    reviewedAt: new Date().toISOString(),
  };
  await scope.update(masterPosts, { review }, eq(masterPosts.id, masterId));
  return review;
}

/** Queue an AI rewrite of one variant's copy (optional instruction). One AI call. */
export async function requestRegenerateCopy(scope: BrandScope, variantId: string, instruction: string) {
  await scope.get(postVariants, variantId);
  return createJob(scope, "regenerate_copy", { variantId, instruction: instruction.slice(0, 1000) }, { autoStart: true, estimate: { aiCalls: 1, imageGenerations: 0, estimatedCostUsd: TEXT_CALL_COST_USD, notes: ["Copywriter rewrite of one variant"] } });
}

/** Queue a new visual for one variant (new image prompt and, with a key, a new background). */
export async function requestRegenerateImage(scope: BrandScope, variantId: string, instruction: string) {
  const v = await scope.get(postVariants, variantId);
  if (v.format === "video_storyboard") throw new ReviewError("Storyboards have no image. Regenerate the copy to rewrite the storyboard.");
  const img = imageProviderStatus();
  return createJob(scope, "regenerate_image", { variantId, instruction: instruction.slice(0, 1000) }, {
    autoStart: true,
    estimate: { aiCalls: 1, imageGenerations: img.connected ? 1 : 0, estimatedCostUsd: TEXT_CALL_COST_USD + (img.connected ? img.costPerImage : 0), notes: [img.connected ? "Visual Director + one new background image" : "Visual Director; image provider not connected"] },
  });
}

export async function regenerateCopy(scope: BrandScope, brand: Brand, variantId: string, instruction: string, jobId: string | null) {
  const v = await scope.get(postVariants, variantId);
  const master = await scope.get(masterPosts, v.masterPostId);
  const brain = await brainForPrompt(scope, { focus: master.coreMessage });
  const target = variantTargets(brand, master.format as PostFormat).filter((t) => t.platform === v.platform && t.language === v.language);
  if (!target.length) throw new ReviewError("This platform or language is no longer active for the brand.");
  const [c] = await writeCopy({ scope, brand, jobId }, master, v.language as Lang, target, brain, instruction || undefined);
  const copy: VariantCopy = { hook: c.hook, caption: c.caption, hashtags: c.hashtags, cta: c.cta, ...(c.title ? { title: c.title } : {}), ...(target[0].slides ? { slides: c.slides } : {}) };
  const visual = v.visual ? { ...v.visual, headline: c.hook.slice(0, 120) } : v.visual;
  const updated = await newVersion(scope, v, { copy, visual }, "regenerate_copy", instruction);
  await logEvent(scope, { masterPostId: master.id, variantId, action: "regenerate_copy", reason: instruction || null });
  await recheckClaims(scope, master.id);
  if (updated.format !== "video_storyboard") await renderVariant(scope, brand, updated, await brandKit(scope, brand), jobId);
  await refreshMasterStatus(scope, master.id);
}

export async function regenerateImage(scope: BrandScope, brand: Brand, variantId: string, instruction: string, jobId: string | null) {
  const v = await scope.get(postVariants, variantId);
  const master = await scope.get(masterPosts, v.masterPostId);
  const brain = await brainForPrompt(scope, { focus: master.coreMessage });
  const [vis] = await directVisuals({ scope, brand, jobId }, master, [{ platform: v.platform as Platform, language: v.language, format: v.format, width: v.width, height: v.height, hook: v.copy.hook }], brain, instruction || undefined);
  const visual = { ...vis, layout: v.visual?.layout === "carousel" ? "carousel" : vis.layout === "carousel" ? "bold_headline" : vis.layout };
  const updated = await newVersion(scope, v, { visual }, "regenerate_image", instruction);
  await logEvent(scope, { masterPostId: master.id, variantId, action: "regenerate_image", reason: instruction || null });
  await renderVariant(scope, brand, updated, await brandKit(scope, brand), jobId, { newBackground: true });
  await refreshMasterStatus(scope, master.id);
}

async function refreshMasterStatus(scope: BrandScope, masterId: string) {
  const vs = await postVariantsOf(scope, masterId);
  const img = vs.filter((v) => v.format !== "video_storyboard");
  const m = await scope.get(masterPosts, masterId);
  if (m.status === "draft" && img.length && img.every((v) => v.status === "rendered" || v.status === "approved")) await scope.update(masterPosts, { status: "rendered" }, eq(masterPosts.id, masterId));
}

/** Approve one variant. An image variant must be rendered first. */
export async function approveVariant(scope: BrandScope, variantId: string, userId?: string) {
  const v = await scope.get(postVariants, variantId);
  if (v.format !== "video_storyboard" && v.status !== "rendered" && v.status !== "approved") throw new ReviewError("Render the image before approving this variant.");
  await scope.update(postVariants, { status: "approved", updatedAt: new Date() }, eq(postVariants.id, variantId));
  await logEvent(scope, { masterPostId: v.masterPostId, variantId, userId, action: "approve" });
  const all = await postVariantsOf(scope, v.masterPostId);
  if (all.every((x) => x.status === "approved")) await scope.update(masterPosts, { status: "approved", rejectReason: null, updatedAt: new Date() }, eq(masterPosts.id, v.masterPostId));
}

/** Approve a whole post: every variant must be rendered (storyboards are approved as text). */
export async function approvePost(scope: BrandScope, masterId: string, userId?: string) {
  const m = await scope.get(masterPosts, masterId);
  if (m.status === "exported") return;
  if (m.status === "concept") throw new ReviewError("This post is not finished yet.");
  const vs = await postVariantsOf(scope, masterId);
  const notReady = vs.filter((v) => v.format !== "video_storyboard" && v.status !== "rendered" && v.status !== "approved");
  if (notReady.length) throw new ReviewError(`Not rendered yet: ${notReady.map((v) => `${v.platform}/${v.language}`).join(", ")}`);
  await scope.update(postVariants, { status: "approved", updatedAt: new Date() }, eq(postVariants.masterPostId, masterId));
  await scope.update(masterPosts, { status: "approved", rejectReason: null, updatedAt: new Date() }, eq(masterPosts.id, masterId));
  await logEvent(scope, { masterPostId: masterId, userId, action: "approve" });
}

export async function rejectPost(scope: BrandScope, masterId: string, reason: string, userId?: string) {
  if (!reason.trim()) throw new ReviewError("Give a reason for rejecting.");
  const m = await scope.get(masterPosts, masterId);
  if (m.status === "exported") throw new ReviewError("This post was already exported.");
  await scope.update(masterPosts, { status: "rejected", rejectReason: reason.trim().slice(0, 1000), updatedAt: new Date() }, eq(masterPosts.id, masterId));
  await logEvent(scope, { masterPostId: masterId, userId, action: "reject", reason });
}

/** Approve every rendered post in a date range that has no flagged claims (bulk review). */
export async function approveCleanPosts(scope: BrandScope, from: string, to: string, userId?: string) {
  const posts = await postsInRange(scope, from, to);
  let n = 0;
  for (const p of posts) {
    if (!["rendered", "draft"].includes(p.status) || !p.review || p.review.flaggedClaims.length) continue;
    try {
      await approvePost(scope, p.id, userId);
      n++;
    } catch (e) {
      if (!(e instanceof ReviewError)) throw e;
    }
  }
  return n;
}

export async function setPostImageSource(scope: BrandScope, masterId: string, source: "generated" | "brand_photo" | "plain") {
  const m = await scope.get(masterPosts, masterId);
  if (m.imageSource === source) return;
  await scope.update(masterPosts, { imageSource: source }, eq(masterPosts.id, masterId));
  // new version for every image variant, then re-render
  for (const v of await postVariantsOf(scope, masterId)) if (v.format !== "video_storyboard") await newVersion(scope, v, {}, "render", `image source: ${source}`);
  return queueRender(scope, [masterId]);
}

export async function postsInRange(scope: BrandScope, from: string, to: string) {
  return scope.db
    .select()
    .from(masterPosts)
    .where(scope.where(masterPosts, and(gte(masterPosts.date, from), lte(masterPosts.date, to))))
    .orderBy(asc(masterPosts.date));
}

/** First image (cover) per variant for a set of posts, for thumbnails. */
export async function coverImages(scope: BrandScope, masterIds: string[]) {
  if (!masterIds.length) return new Map<string, Map<string, string>>();
  const vs = await scope.select(postVariants, inArray(postVariants.masterPostId, masterIds));
  const imgs = vs.length ? await scope.select(assets, inArray(assets.variantId, vs.map((v) => v.id))) : [];
  const out = new Map<string, Map<string, string>>();
  for (const v of vs) {
    const cover = imgs.filter((a) => a.variantId === v.id && a.variantVersion === v.version && (a.slideIndex ?? 0) === 0 && (a.kind === "render" || a.kind === "slide"))[0];
    if (!cover) continue;
    if (!out.has(v.masterPostId)) out.set(v.masterPostId, new Map());
    out.get(v.masterPostId)!.set(`${v.platform}/${v.language}`, cover.id);
  }
  return out;
}

export async function variantHistory(scope: BrandScope, variantId: string) {
  const versions = await scope.db.select().from(postVariantVersions).where(scope.where(postVariantVersions, eq(postVariantVersions.variantId, variantId))).orderBy(desc(postVariantVersions.version));
  const imgs = await scope.select(assets, eq(assets.variantId, variantId));
  return versions.map((ver) => ({ ...ver, images: imgs.filter((a) => a.variantVersion === ver.version && (a.kind === "render" || a.kind === "slide")).sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0)) }));
}

export async function postEvents(scope: BrandScope, masterId: string) {
  return scope.db.select().from(reviewEvents).where(scope.where(reviewEvents, eq(reviewEvents.masterPostId, masterId))).orderBy(desc(reviewEvents.createdAt));
}

