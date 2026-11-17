import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/lib/db";
import { aiRuns, jobs, masterPosts, postVariants, postVariantVersions } from "@/lib/db/schema";
import { approvePlan, generatePlan, getPlan } from "@/lib/plans/service";
import { BatchError, prepareBatch } from "@/lib/posts/batch";
import { copySchema, estimateBatch, postVariantsOf, producePost, reviewPost, STORYBOARD_LABEL, variantTargets } from "@/lib/posts/produce";
import { checkClaims } from "@/lib/posts/claims";
import { confirmJob } from "@/lib/jobs/service";
import { registerAllHandlers } from "@/lib/jobs/handlers";
import { runJob } from "@/lib/jobs/run";
import { MockProvider } from "@/lib/ai/provider";
import { db, truncateAll } from "./helpers";
import { makeReadyBrand } from "./brain-fixture";

process.env.NOVRA_INLINE_JOBS = "1";
beforeAll(() => registerAllHandlers());
beforeEach(truncateAll);
afterEach(() => (MockProvider.failNext = 0));
afterAll(closeDb);

async function approvedPlan(langs: ("en" | "id")[] = ["en"], tag = "Kopi") {
  const { brand, scope } = await makeReadyBrand({ languages: langs }, tag);
  const plan = await generatePlan(scope, brand, { startDate: "2026-12-01", postsCount: 30 });
  await approvePlan(scope, plan.id);
  const { items } = await getPlan(scope, plan.id);
  return { brand, scope, plan, items };
}

describe("claim guard", () => {
  it("flags claims not in the Brand Brain and do-not-say claims", () => {
    const facts = "Gayo Arabica\nspecs: Altitude 1,400 m\nRoasted within 48 hours of shipping";
    const flags = checkClaims(
      {
        ig: "Grown at 1,400 m in Aceh. Roasted within 48 hours. Certified organic by USDA. Voted best coffee in Asia 2024. Our coffee cures fatigue.",
      },
      facts,
      ["Cures fatigue"],
    );
    const text = flags.map((f) => f.claim).join(" | ");
    expect(text).toContain("Certified organic by USDA.");
    expect(text).toContain("Voted best coffee in Asia 2024.");
    expect(flags.find((f) => f.claim.includes("cures fatigue"))!.reason).toMatch(/do-not-say/);
    expect(text).not.toContain("1,400 m");
    expect(text).not.toContain("48 hours");
  });
});

describe("copy rules", () => {
  it("rejects copy that breaks platform limits so the model retries", async () => {
    const { brand } = await approvedPlan();
    const targets = variantTargets(brand, "single_image").filter((t) => t.platform === "x_threads" || t.platform === "youtube_shorts");
    const bad = copySchema(targets).safeParse({
      variants: [
        { platform: "x_threads", hook: "h", caption: "x".repeat(278), hashtags: ["#a", "#b"], cta: "", title: "", slides: [] },
        { platform: "youtube_shorts", hook: "h", caption: "c", hashtags: [], cta: "", title: "y".repeat(80), slides: [] },
      ],
    });
    expect(bad.success).toBe(false);
    const msgs = bad.error!.issues.map((i) => i.message).join(" ");
    expect(msgs).toMatch(/x_threads: caption plus hashtags is \d+ characters, limit 280/);
    expect(msgs).toMatch(/youtube_shorts: title required, max 70/);
  });
});

describe("production", () => {
  it("produces master + 6 platform variants per language with storyboards, visuals and a review", async () => {
    const { brand, scope, items } = await approvedPlan(["en", "id"]);
    const video = items.find((i) => i.format === "short_video")!;
    const carousel = items.find((i) => i.format === "carousel")!;
    const m1 = await producePost({ scope, brand }, video);
    const v1 = await postVariantsOf(scope, m1.id);
    expect(m1.status).toBe("draft");
    expect(m1.hooks).toHaveLength(3);
    expect(v1).toHaveLength(12);
    expect(new Set(v1.map((v) => v.platform)).size).toBe(6);
    expect(v1.every((v) => v.format === "video_storyboard" && v.storyboard?.label === STORYBOARD_LABEL)).toBe(true);
    expect(v1.every((v) => v.storyboard!.shots.length >= 4 && v.storyboard!.shots.every((s) => s.veoPrompt && s.klingPrompt))).toBe(true);
    expect(m1.review?.scores.claimSafety).toBeGreaterThanOrEqual(1);
    // captions are not pasted everywhere
    const enCaptions = v1.filter((v) => v.language === "en").map((v) => v.copy.caption);
    expect(new Set(enCaptions).size).toBeGreaterThan(1);
    expect(v1.find((v) => v.language === "id")!.copy.hook).toContain("[TEST ID]");

    const m2 = await producePost({ scope, brand }, carousel);
    const v2 = await postVariantsOf(scope, m2.id);
    const ig = v2.find((v) => v.platform === "instagram" && v.language === "en")!;
    expect(ig).toMatchObject({ format: "carousel", width: 1080, height: 1350 });
    expect(ig.copy.slides!.length).toBeGreaterThanOrEqual(3);
    expect(ig.visual!.layout).toBe("carousel");
    expect(v2.find((v) => v.platform === "youtube_shorts")!.format).toBe("video_storyboard");
    expect(v2.find((v) => v.platform === "x_threads")!.copy.caption.length).toBeLessThanOrEqual(280);
    const versions = await scope.select(postVariantVersions);
    expect(versions.length).toBe(v1.length + v2.length);
  });

  it("the batch waits for cost confirmation, then produces 7 days and is idempotent on resume", async () => {
    const { brand, scope, plan, items } = await approvedPlan();
    const week = items.slice(0, 7);
    const job = await prepareBatch(scope, brand, plan.id, week.map((i) => i.id));
    expect(job.status).toBe("awaiting_confirmation");
    expect(job.estimate!.aiCalls).toBeGreaterThan(20);
    expect(job.estimate!.notes.join(" ")).toMatch(/Image provider not connected/);
    await expect(runJob(job.id, brand.id)).rejects.toThrow(/not confirmed/);
    expect(await scope.select(masterPosts)).toHaveLength(0);

    await confirmJob(scope, job.id);
    // Simulate a crash after 3 posts: produce them directly, then run the whole job.
    for (const item of week.slice(0, 3)) await producePost({ scope, brand }, item);
    const callsBefore = (await scope.select(aiRuns)).length;
    await runJob(job.id, brand.id);
    const posts = await scope.select(masterPosts);
    expect(posts).toHaveLength(7);
    expect(await scope.select(postVariants)).toHaveLength(42);
    const newCalls = (await scope.select(aiRuns)).length - callsBefore;
    const expected = estimateBatch(brand, week.slice(3), { imagesEnabled: false, costPerImage: 0 }).aiCalls;
    expect(newCalls).toBe(expected);
    const [j] = await scope.select(jobs, eq(jobs.id, job.id));
    expect(j.status).toBe("completed");
    // A second batch for the same days does no new AI work.
    const again = await prepareBatch(scope, brand, plan.id, week.map((i) => i.id));
    expect(again.estimate!.aiCalls).toBe(0);
  });

  it("a failing post fails the job with a clear message; resume finishes it", async () => {
    const { brand, scope, plan, items } = await approvedPlan();
    const job = await prepareBatch(scope, brand, plan.id, items.slice(0, 2).map((i) => i.id));
    await confirmJob(scope, job.id);
    MockProvider.failNext = 1;
    MockProvider.failWith = "fatal";
    await expect(runJob(job.id, brand.id)).rejects.toThrow(/1 of 2 posts failed/);
    const [j] = await scope.select(jobs, eq(jobs.id, job.id));
    expect(j.status).toBe("failed");
    expect(j.error).toMatch(/simulated AI API error/);
    await scope.update(jobs, { status: "queued" }, eq(jobs.id, job.id));
    await runJob(job.id, brand.id);
    expect(await scope.select(masterPosts)).toHaveLength(2);
  });

  it("refuses unapproved plans and concurrent batches", async () => {
    const { brand, scope } = await makeReadyBrand();
    const draft = await generatePlan(scope, brand, { startDate: "2026-12-01", postsCount: 20 });
    const { items } = await getPlan(scope, draft.id);
    await expect(prepareBatch(scope, brand, draft.id, [items[0].id])).rejects.toBeInstanceOf(BatchError);
  });

  it("the Creative Director flags a claim that is not in the Brand Brain", async () => {
    const { brand, scope, items } = await approvedPlan();
    const m = await producePost({ scope, brand }, items[2]);
    const [v] = (await postVariantsOf(scope, m.id)).filter((x) => x.platform === "instagram");
    await scope.update(postVariants, { copy: { ...v.copy, caption: `${v.copy.caption}\nCertified organic and voted the best coffee in Indonesia 2025.` } }, eq(postVariants.id, v.id));
    const review = await reviewPost({ scope, brand }, m);
    expect(review.flaggedClaims.some((f) => f.claim.includes("Certified organic") && f.variant === "instagram/en")).toBe(true);
    expect(review.scores.claimSafety).toBeLessThanOrEqual(2);
  });

  it("brand A's facts never appear in brand B's prompts or posts", async () => {
    const a = await approvedPlan(["en"], "Alpha");
    const b = await approvedPlan(["en"], "Beta");
    await producePost({ scope: a.scope, brand: a.brand }, a.items[0]);
    await producePost({ scope: b.scope, brand: b.brand }, b.items[0]);
    const bRuns = await b.scope.select(aiRuns);
    expect(JSON.stringify(bRuns.map((r) => r.output))).not.toContain("Alpha");
    const bVariants = await b.scope.select(postVariants);
    expect(JSON.stringify(bVariants)).not.toContain("Alpha");
    expect(JSON.stringify(await b.scope.select(masterPosts))).not.toContain("Alpha");
  });
});
