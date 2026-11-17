import { ingestDocument } from "../brand-brain/ingest";
import { generatePlan } from "../plans/service";
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
}
