import { Queue } from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAME = "novra";

export function redisConnection() {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379/0", { maxRetriesPerRequest: null });
}

let queue: Queue | undefined;
let queueConn: IORedis | undefined;
export function getQueue() {
  if (!queue) {
    queueConn = redisConnection();
    queue = new Queue(QUEUE_NAME, { connection: queueConn });
  }
  return queue;
}

export async function closeQueue() {
  if (!queue) return;
  const q = queue;
  queue = undefined;
  await q.close();
  queueConn?.disconnect(); // BullMQ leaves connections it was given open
  queueConn = undefined;
}
