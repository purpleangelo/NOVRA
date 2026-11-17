import { asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { BrandScope } from "../brands/scope";
import { brands, contentPlans, jobs, masterPosts, planItems } from "../db/schema";
import { createJob, setProgress } from "../jobs/service";
import { imageProviderStatus } from "../render/image-provider";
import { estimateBatch, producePost } from "./produce";

type Brand = typeof brands.$inferSelect;

export class BatchError extends Error {}

/** Plan items of an approved plan, optionally limited to a date range. */
export async function approvedPlanItems(scope: BrandScope, planId: string, from?: string, to?: string) {
  const plan = await scope.get(contentPlans, planId);
  if (plan.status !== "approved") throw new BatchError("Approve the content plan before producing posts.");
  const items = await scope.db
    .select()
    .from(planItems)
    .where(scope.where(planItems, eq(planItems.planId, planId)))
    .orderBy(asc(planItems.date), asc(planItems.position));
  return items.filter((i) => (!from || i.date >= from) && (!to || i.date <= to));
}

/** Posts already fully produced (have a review) among these items. */
export async function finishedItemIds(scope: BrandScope, itemIds: string[]) {
  if (!itemIds.length) return new Set<string>();
  const rows = await scope.select(masterPosts, inArray(masterPosts.planItemId, itemIds), isNotNull(masterPosts.review));
  return new Set(rows.map((r) => r.planItemId));
}

/**
 * Prepares a production batch: computes the cost estimate and creates a job that waits for the operator's
 * confirmation. Nothing is generated or spent until confirmJob() is called.
 */
export async function prepareBatch(scope: BrandScope, brand: Brand, planId: string, itemIds: string[]) {
  if (!itemIds.length) throw new BatchError("Pick at least one day to produce.");
  const all = await approvedPlanItems(scope, planId);
  const items = all.filter((i) => itemIds.includes(i.id));
  if (items.length !== new Set(itemIds).size) throw new BatchError("Some selected days are not part of this plan.");
  const running = await scope.select(jobs, eq(jobs.type, "produce_batch"), inArray(jobs.status, ["queued", "running"]));
  if (running.length) throw new BatchError("A batch is already running for this brand. Wait for it to finish.");
  const done = await finishedItemIds(scope, items.map((i) => i.id));
  const todo = items.filter((i) => !done.has(i.id));
  const img = imageProviderStatus();
  const estimate = estimateBatch(brand, todo, { imagesEnabled: img.connected, costPerImage: img.costPerImage, alreadyDone: done.size });
  return createJob(scope, "produce_batch", { planId, itemIds: items.map((i) => i.id) }, { estimate });
}

/** afterPost: rendering, run right after each post is written. */
export type BatchHooks = { afterPost?: (masterId: string) => Promise<void> };

/** Job handler: produces every selected post. Finished posts are skipped, so an interrupted batch resumes cleanly. */
export async function runProduceBatch(scope: BrandScope, brand: Brand, jobId: string, params: { planId: string; itemIds: string[] }, hooks: BatchHooks = {}) {
  const items = (await approvedPlanItems(scope, params.planId)).filter((i) => params.itemIds.includes(i.id));
  const failures: string[] = [];
  let done = 0;
  for (const item of items) {
    await setProgress(scope, jobId, { done, total: items.length, message: `Producing ${item.date} (${item.format.replace("_", " ")})` });
    try {
      const master = await producePost({ scope, brand, jobId }, item);
      if (hooks.afterPost) await hooks.afterPost(master.id);
    } catch (err) {
      failures.push(`${item.date}: ${(err as Error).message}`);
    }
    done++;
  }
  await setProgress(scope, jobId, { done, total: items.length, message: failures.length ? `${failures.length} post(s) failed` : `${items.length} post(s) produced` });
  if (failures.length) throw new BatchError(`${failures.length} of ${items.length} posts failed. Resume the job to retry them.\n${failures.join("\n")}`);
  return { produced: items.length };
}
