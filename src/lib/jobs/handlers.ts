import { ingestDocument } from "../brand-brain/ingest";
import { generatePlan } from "../plans/service";
import { runProduceBatch } from "../posts/batch";
import { renderPost } from "../render/render";
import { regenerateCopy, regenerateImage } from "../posts/review";
import { registerHandler } from "./run";

let registered = false;
/** Registers every job handler. Called by the worker and by tests. */
export function registerAllHandlers() {
  if (registered) return;
  registered = true;
  registerHandler("ingest_document", async ({ scope, job, brand }) => {
    return ingestDocument(scope, String(job.params.documentId), job.id, brand.name);
  });
  registerHandler("generate_plan", async ({ scope, job, brand }) => {
    const p = job.params as { startDate: string; postsCount: number; notes?: string };
    const plan = await generatePlan(scope, brand, { startDate: p.startDate, postsCount: p.postsCount, notes: p.notes, jobId: job.id });
    return { planId: plan.id };
  });
  registerHandler("produce_batch", async ({ scope, job, brand }) => {
    // Each post is rendered (step 5) right after its copy is written, inside the same resumable batch.
    return runProduceBatch(scope, brand, job.id, job.params as { planId: string; itemIds: string[] }, {
      afterPost: (masterId) => renderPost(scope, brand, masterId, job.id),
    });
  });
  registerHandler("render_variants", async ({ scope, job, brand }) => {
    const ids = (job.params.masterPostIds as string[]) ?? [];
    for (const id of ids) await renderPost(scope, brand, id, job.id);
    return { rendered: ids.length };
  });
  registerHandler("regenerate_copy", async ({ scope, job, brand }) => {
    await regenerateCopy(scope, brand, String(job.params.variantId), String(job.params.instruction ?? ""), job.id);
  });
  registerHandler("regenerate_image", async ({ scope, job, brand }) => {
    await regenerateImage(scope, brand, String(job.params.variantId), String(job.params.instruction ?? ""), job.id);
  });
}
