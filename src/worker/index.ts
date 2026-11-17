/**
 * NOVRA background worker. Runs batch generation, rendering and document ingestion outside web requests.
 * Start with `npm run worker`.
 */
import { startWorkers } from "../lib/jobs/worker";

startWorkers().catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
