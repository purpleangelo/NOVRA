import { Worker } from "bullmq";
import { closeDb } from "../db";
import { registerAllHandlers } from "./handlers";
import { QUEUE_NAME, redisConnection } from "./queue";
import { runJob } from "./run";
import { closeBrowser } from "../render/render";
import { inArray } from "drizzle-orm";
import { getDb } from "../db";
import { jobs } from "../db/schema";
import { getQueue } from "./queue";

/**
 * After a crash or restart, jobs the database still marks queued/running may have no live queue entry.
 * Put them back on the queue; handlers skip finished work, so nothing is duplicated.
 */
export async function recoverJobs() {
  const open = await getDb().select().from(jobs).where(inArray(jobs.status, ["queued", "running"]));
  const q = getQueue();
  for (const j of open) {
    const existing = await q.getJob(j.id);
    const state = existing ? await existing.getState() : "missing";
    if (["waiting", "active", "delayed", "prioritized", "waiting-children"].includes(state)) continue;
    if (existing) await existing.remove().catch(() => undefined);
    await q.add(j.type, { jobId: j.id, brandId: j.brandId }, { jobId: j.id, attempts: 3, backoff: { type: "exponential", delay: 5000 } });
    console.log(`[worker] re-queued interrupted job ${j.type} ${j.id} (was ${state})`);
  }
}

export async function startWorkers() {
  registerAllHandlers();
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { jobId, brandId } = job.data as { jobId: string; brandId: string };
      console.log(`[worker] ${job.name} ${jobId} started`);
      await runJob(jobId, brandId);
      console.log(`[worker] ${job.name} ${jobId} done`);
    },
    { connection: redisConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2), lockDuration: 30_000, stalledInterval: 15_000, maxStalledCount: 5 },
  );
  worker.on("failed", (job, err) => console.error(`[worker] ${job?.name} ${job?.id} failed:`, err.message));
  await recoverJobs();
  console.log("[worker] ready");
  const shutdown = async () => {
    console.log("[worker] shutting down");
    await worker.close();
    await closeBrowser();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  return worker;
}
