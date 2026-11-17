import { Queue } from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAME = "novra";

export function redisConnection() {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379/0", { maxRetriesPerRequest: null });
}

let queue: Queue | undefined;
export function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
  return queue;
}
