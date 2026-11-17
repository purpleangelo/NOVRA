import { eq } from "drizzle-orm";
import { brandScope, type BrandScope } from "../brands/scope";
import { getDb } from "../db";
import { brands, jobs } from "../db/schema";
import type { Job } from "./service";

type Handler = (ctx: { scope: BrandScope; job: Job; brand: typeof brands.$inferSelect }) => Promise<Record<string, unknown> | void>;
const handlers = new Map<string, Handler>();

export function registerHandler(type: string, handler: Handler) {
  handlers.set(type, handler);
}

/**
 * Runs one job by id. Marks it running, calls its handler and records completion or the error.
 * Handlers must be idempotent: a job that was interrupted is simply run again and skips finished work.
 */
export async function runJob(jobId: string, brandId: string) {
  const db = getDb();
  const { scope, brand } = await brandScope(db, brandId);
  const job = await scope.get(jobs, jobId);
  if (job.status === "cancelled" || job.status === "completed") return;
  if (job.status === "awaiting_confirmation") throw new Error("Job was not confirmed by the operator");
  const handler = handlers.get(job.type);
  if (!handler) throw new Error(`No handler for job type ${job.type}`);
  await scope.update(jobs, { status: "running", startedAt: job.startedAt ?? new Date(), error: null }, eq(jobs.id, jobId));
  try {
    const result = await handler({ scope, job, brand });
    const [latest] = await scope.select(jobs, eq(jobs.id, jobId));
    await scope.update(
      jobs,
      { status: "completed", finishedAt: new Date(), progress: { ...latest.progress, done: latest.progress.total || latest.progress.done, message: result ? JSON.stringify(result) : latest.progress.message } },
      eq(jobs.id, jobId),
    );
  } catch (err) {
    await scope.update(jobs, { status: "failed", error: (err as Error).message, finishedAt: new Date() }, eq(jobs.id, jobId));
    throw err;
  }
}
