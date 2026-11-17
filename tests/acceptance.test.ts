/**
 * Milestone 1 acceptance tests (SPEC §8), end to end through the same services and jobs the UI uses.
 * Worker kill/resume with a real BullMQ worker process is in acceptance-worker.test.ts; container restart is a
 * manual check (docs/MANUAL_TEST.md), its result is in docs/REPORT.md.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { closeDb } from "@/lib/db";
import { aiRuns, assets, brandBrainEntries, documents, jobs, masterPosts, postVariants } from "@/lib/db/schema";
import { brandScope, type BrandScope } from "@/lib/brands/scope";
import { createBrand } from "@/lib/brands/service";
import { brainIntegrity, listEntries, setEntryStatus } from "@/lib/brand-brain/service";
import { uploadAsset, uploadDocument } from "@/lib/brand-brain/uploads";
import { createJob, confirmJob } from "@/lib/jobs/service";
import { registerAllHandlers } from "@/lib/jobs/handlers";
import { runJob } from "@/lib/jobs/run";
import { approvePlan, latestPlan } from "@/lib/plans/service";
import { approvedPlanItems, prepareBatch } from "@/lib/posts/batch";
import { approvePost, editVariant, variantHistory } from "@/lib/posts/review";
import { createExport } from "@/lib/export/export";
import { MockProvider, setTextProvider, type CompletionRequest } from "@/lib/ai/provider";
import { closeBrowser, variantImages } from "@/lib/render/render";
import { imageProviderStatus, setImageProvider } from "@/lib/render/image-provider";
import { getStorage } from "@/lib/storage";
import { UploadError } from "@/lib/brand-brain/extract";
import { db, truncateAll } from "./helpers";
import { makeDocx, PNG_1PX } from "./fixtures";
import { makeReadyBrand } from "./brain-fixture";

process.env.NOVRA_INLINE_JOBS = "1";

/** Records every prompt sent to the (mock) model, to prove what each brand's prompts contained. */
const prompts: string[] = [];
class RecordingProvider extends MockProvider {
  async complete(req: CompletionRequest) {
    prompts.push(`${req.system}\n${req.user}`);
    return super.complete(req);
  }
}

beforeAll(() => {
  registerAllHandlers();
  setImageProvider(null); // no image API key
  setTextProvider(new RecordingProvider());
});
beforeEach(async () => {
  await truncateAll();
  prompts.length = 0;
});
afterEach(() => {
  MockProvider.failNext = 0;
});
afterAll(async () => {
  setTextProvider(undefined);
  setImageProvider(undefined);
  await closeBrowser();
  await closeDb();
});

const brainDoc = (tag: string) => `Company: ${tag} TEST Coffee
Sells: Single-origin coffee beans
Markets: Indonesia
Story: A TEST roastery.
Product: ${tag} Gayo Arabica 250g
Description: Washed arabica from Aceh
Spec: Altitude 1,400 m
Persona: ${tag} urban coffee lover
Persona description: 25-35, works in Jakarta
Persona: ${tag} home brewer
Personality: Warm, precise
Do words: fresh, origin
Don't words: cheap
Sample caption: Morning starts at the farm.
Colour: Coffee brown #4B2E1E
Colour: Cream #F3E9DC
Heading font: Playfair Display
Body font: Inter
Claim: Roasted within 48 hours of shipping
Source: Roastery SOP v2, page 1
Do not say: Cures fatigue
Reason: Health claim`;

async function queuedJobs(scope: BrandScope, brandId: string) {
  for (const j of await scope.select(jobs, eq(jobs.status, "queued"))) await runJob(j.id, brandId);
}

/** create → Brand Brain (document + approval) → 30-day plan → approve → produce 7 days → review → approve → export */
async function fullFlow(tag: string, opts: { languages?: ("en" | "id")[] } = {}) {
  const brand = await createBrand(db(), {
    name: `${tag} TEST brand`,
    languages: opts.languages ?? ["en"],
    platforms: ["instagram", "tiktok", "youtube_shorts", "facebook", "linkedin", "x_threads"],
    isTest: true,
  });
  const { scope } = await brandScope(db(), brand.id);

  // Brand Brain: upload a document, approve the proposals, add a brand photo.
  const { job: ingest } = await uploadDocument(scope, `${tag}-profile.docx`, await makeDocx(brainDoc(tag).split("\n")));
  await runJob(ingest.id, brand.id);
  for (const e of await listEntries(scope, { status: "proposed" })) await setEntryStatus(scope, e.id, "approved");
  expect((await brainIntegrity(scope)).readyForPlanning).toBe(true);
  await uploadAsset(scope, "photo", `${tag}-shop.png`, PNG_1PX);

  // 30-day plan via the Strategist job, then approval.
  const planJob = await createJob(scope, "generate_plan", { startDate: "2026-12-01", postsCount: 30 }, { autoStart: true });
  await runJob(planJob.id, brand.id);
  const plan = (await latestPlan(scope))!;
  await approvePlan(scope, plan.id);

  // Produce the first 7 days: estimate first, nothing runs until confirmed.
  const week = await approvedPlanItems(scope, plan.id, "2026-12-01", "2026-12-07");
  const batch = await prepareBatch(scope, brand, plan.id, week.map((i) => i.id));
  expect(batch.status).toBe("awaiting_confirmation");
  expect(batch.estimate!.estimatedCostUsd).toBeGreaterThan(0);
  await expect(runJob(batch.id, brand.id)).rejects.toThrow(/not confirmed/);
  await confirmJob(scope, batch.id);
  await runJob(batch.id, brand.id);
  return { brand, scope, plan, week, batchId: batch.id };
}

describe("acceptance", () => {
  it("full flow on the TEST brand: Brand Brain → plan → 7 days × 6 platforms → review → approve → export", async () => {
    const { brand, scope, week, batchId } = await fullFlow("Arjuna");
    const [batch] = await scope.select(jobs, eq(jobs.id, batchId));
    expect(batch.status).toBe("completed");

    const posts = await scope.select(masterPosts);
    expect(posts).toHaveLength(week.length);
    expect(week.length).toBeGreaterThanOrEqual(7);
    const variants = await scope.select(postVariants);
    expect(variants).toHaveLength(week.length * 6);
    for (const p of posts) {
      expect(new Set(variants.filter((v) => v.masterPostId === p.id).map((v) => v.platform))).toEqual(
        new Set(["instagram", "tiktok", "youtube_shorts", "facebook", "linkedin", "x_threads"]),
      );
      expect(p.review).not.toBeNull();
    }
    // Every image variant is rendered; storyboards are text and never "rendered".
    for (const v of variants) {
      if (v.format === "video_storyboard") {
        expect(v.status).not.toBe("rendered");
        expect(v.storyboard?.label).toMatch(/storyboard/i);
      } else {
        expect(v.status).toBe("rendered");
        expect((await variantImages(scope, v)).length).toBeGreaterThan(0);
      }
    }

    // Review: one inline edit creates version 2 and re-renders.
    const ig = variants.find((v) => v.platform === "instagram" && v.format !== "video_storyboard")!;
    await editVariant(scope, brand, ig.id, { hook: ig.copy.hook, caption: `${ig.copy.caption}\n\nFresh from the farm.`, hashtags: ig.copy.hashtags.join(" "), cta: ig.copy.cta });
    await queuedJobs(scope, brand.id);
    expect((await variantHistory(scope, ig.id)).map((h) => h.version)).toEqual([2, 1]);

    // Approve and export.
    for (const p of posts) await approvePost(scope, p.id);
    const { record, rows } = await createExport(scope, brand, "2026-12-01", "2026-12-07");
    expect(record.postCount).toBe(posts.length);
    expect(rows).toBe(variants.length);
    expect((await scope.select(masterPosts)).every((p) => p.status === "exported")).toBe(true);
    const zip = await JSZip.loadAsync(await getStorage().get(record.storageKey!));
    const names = Object.keys(zip.files);
    expect(names.some((n) => n.endsWith("metricool_bulk_upload.csv"))).toBe(true);
    expect(names.some((n) => n.endsWith("storyboard.md"))).toBe(true);
    expect(names.some((n) => /\.(mp4|mov|webm)$/.test(n))).toBe(false);
  });

  it("two brands: no fact, file, prompt, post or export of brand A appears in brand B", async () => {
    const a = await fullFlow("Arjuna");
    const promptsA = prompts.length;
    const b = await fullFlow("Bromo");
    const promptsB = prompts.slice(promptsA);
    expect(promptsB.length).toBeGreaterThan(10);
    expect(promptsB.some((p) => p.includes("Bromo"))).toBe(true);
    expect(promptsB.filter((p) => p.includes("Arjuna"))).toEqual([]);

    const json = (x: unknown) => JSON.stringify(x);
    expect(json(await b.scope.select(brandBrainEntries))).not.toContain("Arjuna");
    expect(json(await b.scope.select(masterPosts))).not.toContain("Arjuna");
    expect(json(await b.scope.select(postVariants))).not.toContain("Arjuna");
    expect(json(await b.scope.select(aiRuns))).not.toContain("Arjuna");
    for (const f of [...(await b.scope.select(assets)), ...(await b.scope.select(documents))]) expect(f.storageKey.startsWith(`brands/${b.brand.id}/`)).toBe(true);

    for (const p of await b.scope.select(masterPosts)) await approvePost(b.scope, p.id);
    const { record } = await createExport(b.scope, b.brand, "2026-12-01", "2026-12-07");
    const zip = await JSZip.loadAsync(await getStorage().get(record.storageKey!));
    for (const f of Object.values(zip.files).filter((f) => !f.dir && /\.(csv|txt|md)$/.test(f.name))) expect(await f.async("string")).not.toContain("Arjuna");

    // Brand B's scope cannot read brand A's rows, even by id.
    const [postA] = await a.scope.select(masterPosts);
    await expect(b.scope.get(masterPosts, postA.id)).rejects.toThrow();
  });

  it("a claim not in the Brand Brain is flagged by the Creative Director", async () => {
    const { scope, brand } = await fullFlow("Arjuna");
    const [ig] = (await scope.select(postVariants)).filter((v) => v.platform === "instagram" && v.format !== "video_storyboard");
    await editVariant(scope, brand, ig.id, { hook: ig.copy.hook, caption: "Voted the best coffee in Asia, ISO 9001 certified since 2012.", hashtags: ig.copy.hashtags.join(" "), cta: ig.copy.cta });
    const [m] = await scope.select(masterPosts, eq(masterPosts.id, ig.masterPostId));
    expect(m.review!.flaggedClaims.some((f) => /best coffee|ISO 9001/.test(f.claim))).toBe(true);
    expect(m.review!.scores.claimSafety).toBeLessThanOrEqual(2);
  });

  it("no image API key: setup state reported and layouts render on the approved brand photo", async () => {
    expect(imageProviderStatus()).toMatchObject({ connected: false });
    expect(imageProviderStatus().message).toMatch(/FAL_KEY/);
    const { scope } = await fullFlow("Arjuna");
    const rendered = (await scope.select(postVariants)).filter((v) => v.status === "rendered");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.some((v) => /approved brand photo/.test(v.renderError ?? ""))).toBe(true);
    const [photo] = (await scope.select(assets)).filter((a) => a.kind === "photo");
    const imgs = (await Promise.all(rendered.map((v) => variantImages(scope, v)))).flat();
    expect(imgs.some((i) => (i.meta as { backgroundAssetId?: string }).backgroundAssetId === photo.id)).toBe(true);
  });

  it("invalid upload and AI API errors are shown clearly and logged", async () => {
    const r = await makeReadyBrand({}, "Arjuna");
    await expect(uploadDocument(r.scope, "virus.exe", Buffer.from("MZ"))).rejects.toBeInstanceOf(UploadError);
    await expect(uploadDocument(r.scope, "fake.pdf", Buffer.from("not a pdf"))).rejects.toThrow(UploadError);
    expect(await r.scope.select(documents)).toHaveLength(0);

    const planJob = await createJob(r.scope, "generate_plan", { startDate: "2026-12-01", postsCount: 30 }, { autoStart: true });
    MockProvider.failNext = 1;
    MockProvider.failWith = "fatal";
    await expect(runJob(planJob.id, r.brand.id)).rejects.toThrow(/simulated AI API error/);
    const [j] = await r.scope.select(jobs, eq(jobs.id, planJob.id));
    expect(j.status).toBe("failed");
    expect(j.error).toMatch(/simulated AI API error/);
    const runs = await r.scope.select(aiRuns);
    expect(runs.some((x) => x.status === "error" && /simulated AI API error/.test(x.error ?? ""))).toBe(true);
  });
});
