import { Worker } from "bullmq";
import { closeDb } from "../db";
import { QUEUE_NAME, redisConnection } from "./queue";

export async function startWorkers() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[worker] no handler for ${job.name}`);
    },
    { connection: redisConnection(), concurrency: 2 },
  );
  worker.on("failed", (job, err) => console.error(`[worker] job ${job?.id} failed:`, err.message));
  console.log("[worker] ready");
  const shutdown = async () => {
    await worker.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  return worker;
}
