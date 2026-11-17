import { ingestDocument } from "../brand-brain/ingest";
import { registerHandler } from "./run";

let registered = false;
/** Registers every job handler. Called by the worker and by tests. */
export function registerAllHandlers() {
  if (registered) return;
  registered = true;
  registerHandler("ingest_document", async ({ scope, job, brand }) => {
    return ingestDocument(scope, String(job.params.documentId), job.id, brand.name);
  });
}
