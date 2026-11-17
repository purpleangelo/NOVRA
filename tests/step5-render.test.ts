import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { closeDb } from "@/lib/db";
import { assets, masterPosts, postVariants, usageRecords } from "@/lib/db/schema";
import { approvePlan, generatePlan, getPlan } from "@/lib/plans/service";
import { postVariantsOf, producePost } from "@/lib/posts/produce";
import { prepareBatch } from "@/lib/posts/batch";
import { confirmJob } from "@/lib/jobs/service";
import { registerAllHandlers } from "@/lib/jobs/handlers";
import { runJob } from "@/lib/jobs/run";
import { brandKit, closeBrowser, htmlToPng, renderPost, variantImages } from "@/lib/render/render";
import { layoutHtml } from "@/lib/render/templates";
import { LAYOUT_IDS } from "@/lib/render/layouts";
import { setImageProvider, type ImageProvider, imageProviderStatus } from "@/lib/render/image-provider";
import { uploadAsset } from "@/lib/brand-brain/uploads";
import { getStorage } from "@/lib/storage";
import { truncateAll } from "./helpers";
import { makeReadyBrand } from "./brain-fixture";

process.env.NOVRA_INLINE_JOBS = "1";
const OUT = path.resolve(__dirname, "../storage-test/samples");
beforeAll(async () => {
  registerAllHandlers();
  await fs.mkdir(OUT, { recursive: true });
});
beforeEach(truncateAll);
afterEach(() => setImageProvider(undefined));
afterAll(async () => {
  await closeBrowser();
  await closeDb();
});

const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

async function scenePng() {
  return htmlToPng(`<html><body style="margin:0;width:1080px;height:1350px;background:linear-gradient(135deg,#6b4226,#d9b38c)"><div style="position:absolute;left:300px;top:500px;width:480px;height:480px;border-radius:50%;background:#3b2314"></div><script>document.body.dataset.ready='1'</script></body></html>`, 1080, 1350);
}

function fakeProvider(calls: { prompt: string; size: { width: number; height: number } }[]): ImageProvider {
  return {
    name: "fake",
    model: "fake-model",
    async generateImage(prompt, size) {
      calls.push({ prompt, size });
      return { bytes: await scenePng(), mimeType: "image/png", model: "fake-model", costUsd: 0.025 };
    },
  };
}

async function setup(langs: ("en" | "id")[] = ["en"], imageSource: "generated" | "brand_photo" | "plain" = "generated") {
  const r = await makeReadyBrand({ languages: langs, imageSource });
  const plan = await generatePlan(r.scope, r.brand, { startDate: "2026-12-01", postsCount: 30 });
  await approvePlan(r.scope, plan.id);
  const { items } = await getPlan(r.scope, plan.id);
  return { ...r, plan, items };
}

describe("layout templates", () => {
  it("renders all 6 layouts at exact platform sizes", async () => {
    const { scope, brand } = await setup();
    const kit = await brandKit(scope, brand);
    const bg = `data:image/png;base64,${(await scenePng()).toString("base64")}`;
    for (const layout of LAYOUT_IDS)
      for (const [w, h] of [
        [1080, 1350],
        [1080, 1920],
        [1600, 900],
      ]) {
        const png = await htmlToPng(
          layoutHtml({ ...kit, layout, width: w, height: h, headline: "Fresh from Gayo highlands this week", subtext: "Washed arabica, medium roast", textPlacement: "bottom", points: ["Grind fresh", "Use 92°C water", "Brew 3 minutes"], slide: { index: 0, total: 5, heading: "Cover", body: "Swipe" }, backgroundUrl: bg }),
          w,
          h,
        );
        expect(pngSize(png)).toEqual({ width: w, height: h });
        if (w === 1080 && h === 1350) await fs.writeFile(path.join(OUT, `layout-${layout}.png`), png);
      }
  });
});

describe("two-layer rendering", () => {
  it("without an image key: setup state, renders on approved brand photos, else plain colour", async () => {
    setImageProvider(null);
    expect(imageProviderStatus()).toMatchObject({ connected: false, message: expect.stringMatching(/not connected/) });
    const { scope, brand, items } = await setup();
    const single = items.find((i) => i.format === "single_image")!;
    const m1 = await producePost({ scope, brand }, single);
    await renderPost(scope, brand, m1.id, null);
    let vs = await postVariantsOf(scope, m1.id);
    let ig = vs.find((v) => v.platform === "instagram")!;
    let imgs = await variantImages(scope, ig);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].origin).toBe("plain");
    expect(ig.renderError).toMatch(/not connected/);

    await uploadAsset(scope, "photo", "shop.png", await scenePng());
    const m2 = await producePost({ scope, brand }, items.filter((i) => i.format === "single_image")[1]);
    await renderPost(scope, brand, m2.id, null);
    vs = await postVariantsOf(scope, m2.id);
    ig = vs.find((v) => v.platform === "instagram")!;
    imgs = await variantImages(scope, ig);
    expect(imgs[0].origin).toBe("brand_photo");
    const png = await getStorage().get(imgs[0].storageKey);
    expect(pngSize(png)).toEqual({ width: 1080, height: 1350 });
    await fs.writeFile(path.join(OUT, "brand-photo-instagram.png"), png);
    const [master] = await scope.select(masterPosts, eq(masterPosts.id, m2.id));
    expect(master.status).toBe("rendered");
    expect(await scope.select(usageRecords, eq(usageRecords.kind, "image"))).toHaveLength(0);
  });

  it("with an image provider: one background per size reused across languages, cost recorded, carousel slides in order", async () => {
    const calls: { prompt: string; size: { width: number; height: number } }[] = [];
    setImageProvider(fakeProvider(calls));
    const { scope, brand, items } = await setup(["en", "id"]);
    const carousel = items.find((i) => i.format === "carousel")!;
    const m = await producePost({ scope, brand }, carousel);
    await renderPost(scope, brand, m.id, null);
    const vs = await postVariantsOf(scope, m.id);
    const imageVariants = vs.filter((v) => v.format !== "video_storyboard");
    const sizes = new Set(imageVariants.map((v) => `${v.width}x${v.height}`));
    expect(calls).toHaveLength(sizes.size);
    expect(calls.every((c) => /no text/i.test(c.prompt))).toBe(true);
    expect(await scope.select(usageRecords, eq(usageRecords.kind, "image"))).toHaveLength(sizes.size);
    const ig = vs.find((v) => v.platform === "instagram" && v.language === "en")!;
    const slides = await variantImages(scope, ig);
    expect(slides.length).toBe(ig.copy.slides!.length);
    expect(slides.map((s) => s.slideIndex)).toEqual(slides.map((_, i) => i));
    expect(slides[0].origin).toBe("generated");
    await fs.writeFile(path.join(OUT, "carousel-cover.png"), await getStorage().get(slides[0].storageKey));
    await fs.writeFile(path.join(OUT, "carousel-inner.png"), await getStorage().get(slides[1].storageKey));
    const yt = vs.find((v) => v.platform === "youtube_shorts")!;
    expect(yt.status).toBe("draft"); // storyboard: never "rendered"
    expect(await variantImages(scope, yt)).toHaveLength(0);
    // second call renders nothing new
    await renderPost(scope, brand, m.id, null);
    expect(calls).toHaveLength(sizes.size);
  });

  it("a batch renders each post right after writing it", async () => {
    setImageProvider(null);
    const { scope, brand, plan, items } = await setup();
    const job = await prepareBatch(scope, brand, plan.id, items.slice(0, 3).map((i) => i.id));
    await confirmJob(scope, job.id);
    await runJob(job.id, brand.id);
    const renders = await scope.select(assets);
    expect(renders.filter((a) => a.kind === "render" || a.kind === "slide").length).toBeGreaterThan(0);
    const posts = await scope.select(masterPosts);
    for (const p of posts) {
      const vs = await scope.select(postVariants, eq(postVariants.masterPostId, p.id));
      const hasImage = vs.some((v) => v.format !== "video_storyboard");
      expect(p.status).toBe(hasImage ? "rendered" : "draft");
    }
  });
});
