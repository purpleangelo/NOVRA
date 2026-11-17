import { desc, eq, inArray } from "drizzle-orm";
import type { BrandScope } from "../brands/scope";
import { jobs, type JobEstimate } from "../db/schema";
import { getQueue } from "./queue";

export type Job = typeof jobs.$inferSelect;
export type JobType = "ingest_document" | "produce_batch" | "regenerate_copy" | "regenerate_image" | "render_variants";

/**
 * Creates a job. Batch jobs that spend money start as "awaiting_confirmation" and only run after the
 * operator confirms the estimate (confirmJob). Small jobs can be queued straight away.
 */
export async function createJob(scope: BrandScope, type: JobType, params: Record<string, unknown>, opts: { estimate?: JobEstimate; autoStart?: boolean } = {}) {
  const [job] = await scope.insert(jobs, {
    type,
    params,
    estimate: opts.estimate ?? null,
    status: opts.autoStart ? "queued" : "awaiting_confirmation",
    confirmedAt: opts.autoStart ? new Date() : null,
  });
  if (opts.autoStart) await enqueue(job);
  return job;
}

export async function enqueue(job: Job) {
  if (process.env.NOVRA_INLINE_JOBS === "1") return; // tests run handlers directly
  await getQueue().add(job.type, { jobId: job.id, brandId: job.brandId }, { jobId: job.id, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 1000, removeOnFail: 1000 });
}

export class JobStateError extends Error {}

export async function confirmJob(scope: BrandScope, jobId: string) {
  const job = await scope.get(jobs, jobId);
  if (job.status !== "awaiting_confirmation") throw new JobStateError(`Job is ${job.status}, not awaiting confirmation`);
  const [updated] = await scope.update(jobs, { status: "queued", confirmedAt: new Date() }, eq(jobs.id, jobId));
  await enqueue(updated);
  return updated;
}

export async function cancelJob(scope: BrandScope, jobId: string) {
  const job = await scope.get(jobs, jobId);
  if (!["awaiting_confirmation", "queued", "failed"].includes(job.status)) throw new JobStateError(`A ${job.status} job cannot be cancelled`);
  await scope.update(jobs, { status: "cancelled", finishedAt: new Date() }, eq(jobs.id, jobId));
}

/** Re-queue a failed or interrupted job. Handlers skip work that is already done, so nothing is duplicated. */
export async function resumeJob(scope: BrandScope, jobId: string) {
  const job = await scope.get(jobs, jobId);
  if (!["failed", "running", "queued"].includes(job.status)) throw new JobStateError(`A ${job.status} job cannot be resumed`);
  const [updated] = await scope.update(jobs, { status: "queued", error: null }, eq(jobs.id, jobId));
  if (process.env.NOVRA_INLINE_JOBS !== "1") {
    const q = getQueue();
    const existing = await q.getJob(jobId);
    if (existing) await existing.remove().catch(() => undefined);
  }
  await enqueue(updated);
  return updated;
}

export async function setProgress(scope: BrandScope, jobId: string, progress: { done: number; total: number; message?: string }) {
  await scope.update(jobs, { progress }, eq(jobs.id, jobId));
}

export async function listJobs(scope: BrandScope, limit = 50) {
  return scope.db.select().from(jobs).where(scope.where(jobs)).orderBy(desc(jobs.createdAt)).limit(limit);
}

export async function activeJobs(scope: BrandScope) {
  return scope.db
    .select()
    .from(jobs)
    .where(scope.where(jobs, inArray(jobs.status, ["queued", "running"])));
}
