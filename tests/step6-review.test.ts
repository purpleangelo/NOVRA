import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/lib/db";
import { jobs, masterPosts, postVariants, reviewEvents } from "@/lib/db/schema";
import { approvePlan, generatePlan, getPlan } from "@/lib/plans/service";
import { postVariantsOf, producePost } from "@/lib/posts/produce";
import {
  approveCleanPosts,
  approvePost,
  approveVariant,
  editVariant,
  parseSlides,
  rejectPost,
  requestRegenerateCopy,
  requestRegenerateImage,
  ReviewError,
  setPostImageSource,
  slidesToText,
  variantHistory,
} from "@/lib/posts/review";
import { registerAllHandlers } from "@/lib/jobs/handlers";
import { runJob } from "@/lib/jobs/run";
import { closeBrowser, renderPost, variantImages } from "@/lib/render/render";
import { setImageProvider } from "@/lib/render/image-provider";
import { truncateAll } from "./helpers";
import { makeReadyBrand } from "./brain-fixture";

process.env.NOVRA_INLINE_JOBS = "1";
beforeAll(() => {
  registerAllHandlers();
  setImageProvider(null);
});
beforeEach(truncateAll);
afterAll(async () => {
  setImageProvider(undefined);
  await closeBrowser();
  await closeDb();
});

async function producedPost(format: "single_image" | "carousel" | "short_video" = "single_image") {
  const r = await makeReadyBrand();
  const plan = await generatePlan(r.scope, r.brand, { startDate: "2026-12-01", postsCount: 30 });
  await approvePlan(r.scope, plan.id);
  const { items } = await getPlan(r.scope, plan.id);
  const item = items.find((i) => i.format === format)!;
  const m = await producePost({ scope: r.scope, brand: r.brand }, item);
  await renderPost(r.scope, r.brand, m.id, null);
  return { ...r, master: m, variants: await postVariantsOf(r.scope, m.id) };
}

async function runQueued(scope: Awaited<ReturnType<typeof producedPost>>["scope"], brandId: string) {
  for (const j of await scope.select(jobs, eq(jobs.status, "queued"))) await runJob(j.id, brandId);
}

describe("post review", () => {
  it("inline edit creates a new version, re-renders, re-checks claims, old version stays viewable", async () => {
    const { scope, brand, master, variants } = await producedPost();
    const ig = variants.find((v) => v.platform === "instagram")!;
    const oldImages = await variantImages(scope, ig);
    const updated = await editVariant(scope, brand, ig.id, { hook: "New hook", caption: "New hook\n\nISO 9001 certified since 2010.", hashtags: "#kopi kopi #coffee #kopi #a #b", cta: "Order now", headline: "Fresh this week", subtext: "" });
    expect(updated.version).toBe(2);
    expect(updated.copy.hashtags).toEqual(["#kopi", "#coffee", "#a", "#b"]);
    const [m] = await scope.select(masterPosts, eq(masterPosts.id, master.id));
    expect(m.review!.flaggedClaims.some((f) => f.claim.includes("ISO 9001"))).toBe(true);
    expect(m.status).toBe("draft");
    await runQueued(scope, brand.id);
    const [v2] = await scope.select(postVariants, eq(postVariants.id, ig.id));
    expect(v2.status).toBe("rendered");
    const history = await variantHistory(scope, ig.id);
    expect(history.map((h) => h.version)).toEqual([2, 1]);
    expect(history[1].images.map((i) => i.id)).toEqual(oldImages.map((i) => i.id));
    expect(history[0].images).toHaveLength(1);
    expect(history[0].reason).toBe("edit");
  });

  it("rejects edits that break platform limits", async () => {
    const { scope, brand, variants } = await producedPost();
    const x = variants.find((v) => v.platform === "x_threads")!;
    await expect(editVariant(scope, brand, x.id, { hook: "h", caption: "a".repeat(290), hashtags: "", cta: "" })).rejects.toThrow(/limit is 280/);
    const tt = variants.find((v) => v.platform === "tiktok")!;
    await expect(editVariant(scope, brand, tt.id, { hook: "h", caption: "c", hashtags: "#a #b #c #d #e #f", cta: "" })).rejects.toThrow(/at most 5/);
  });

  it("regenerate copy and image run as jobs and create versions with the instruction", async () => {
    const { scope, brand, variants } = await producedPost("carousel");
    const ig = variants.find((v) => v.platform === "instagram")!;
    await requestRegenerateCopy(scope, ig.id, "Shorter, more playful");
    await requestRegenerateImage(scope, ig.id, "Warmer light");
    await runQueued(scope, brand.id);
    const history = await variantHistory(scope, ig.id);
    expect(history.map((h) => [h.version, h.reason, h.instruction])).toEqual([
      [3, "regenerate_image", "Warmer light"],
      [2, "regenerate_copy", "Shorter, more playful"],
      [1, "generated", null],
    ]);
    expect(history[0].images.length).toBe(ig.copy.slides!.length);
    const yt = variants.find((v) => v.platform === "youtube_shorts")!;
    await expect(requestRegenerateImage(scope, yt.id, "")).rejects.toBeInstanceOf(ReviewError);
  });

  it("approve variant / approve post / reject with reason; events are logged", async () => {
    const { scope, master, variants } = await producedPost();
    for (const v of variants.slice(0, -1)) await approveVariant(scope, v.id);
    expect((await scope.get(masterPosts, master.id)).status).toBe("rendered");
    await approveVariant(scope, variants.at(-1)!.id);
    expect((await scope.get(masterPosts, master.id)).status).toBe("approved");
    await expect(rejectPost(scope, master.id, "  ")).rejects.toThrow(/reason/);
    await rejectPost(scope, master.id, "Off-brand tone");
    const m = await scope.get(masterPosts, master.id);
    expect(m).toMatchObject({ status: "rejected", rejectReason: "Off-brand tone" });
    await approvePost(scope, master.id);
    expect((await scope.get(masterPosts, master.id)).status).toBe("approved");
    const events = await scope.select(reviewEvents, eq(reviewEvents.masterPostId, master.id));
    expect(events.map((e) => e.action).filter((a) => a !== "approve")).toEqual(["reject"]);
  });

  it("video-only posts can be approved without rendering; storyboards stay storyboards", async () => {
    const { scope, master, variants } = await producedPost("short_video");
    expect(variants.every((v) => v.format === "video_storyboard" && v.status === "draft")).toBe(true);
    await approvePost(scope, master.id);
    const after = await postVariantsOf(scope, master.id);
    expect(after.every((v) => v.status === "approved" && v.storyboard?.label.includes("not rendered"))).toBe(true);
  });

  it("bulk-approves clean rendered posts only; image source can be changed per post", async () => {
    const { scope, brand, master } = await producedPost();
    expect(await approveCleanPosts(scope, "2026-12-01", "2026-12-31")).toBe(1);
    await setPostImageSource(scope, master.id, "plain");
    await runQueued(scope, brand.id);
    const [m] = await scope.select(masterPosts, eq(masterPosts.id, master.id));
    expect(m.imageSource).toBe("plain");
    expect(m.status).toBe("rendered");
  });

  it("slides text round-trips", () => {
    const slides = [
      { heading: "One", body: "first" },
      { heading: "Two", body: "second\nline" },
    ];
    expect(parseSlides(slidesToText(slides))).toEqual(slides);
  });
});
