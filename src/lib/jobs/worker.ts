import { Worker } from "bullmq";
import { closeDb } from "../db";
import { registerAllHandlers } from "./handlers";
import { QUEUE_NAME, redisConnection } from "./queue";
import { runJob } from "./run";

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
    { connection: redisConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2), lockDuration: 5 * 60 * 1000 },
  );
  worker.on("failed", (job, err) => console.error(`[worker] ${job?.name} ${job?.id} failed:`, err.message));
  console.log("[worker] ready");
  const shutdown = async () => {
    console.log("[worker] shutting down");
    await worker.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  return worker;
}
