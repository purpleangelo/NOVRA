/**
 * Acceptance: kill the worker mid-batch, restart it, and the batch resumes without duplicate posts.
 * Uses a real worker process (`src/worker/index.ts`) and a real BullMQ queue on the test Redis database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import { closeDb } from "@/lib/db";
import { jobs, masterPosts, postVariants } from "@/lib/db/schema";
import { confirmJob } from "@/lib/jobs/service";
import { closeQueue, getQueue } from "@/lib/jobs/queue";
import { approvePlan, generatePlan } from "@/lib/plans/service";
import { approvedPlanItems, prepareBatch } from "@/lib/posts/batch";
import { truncateAll } from "./helpers";
import { makeReadyBrand } from "./brain-fixture";

const root = path.resolve(__dirname, "..");
const children: ChildProcess[] = [];
const log: string[] = [];

function startWorker() {
  const env: NodeJS.ProcessEnv = { ...process.env, WORKER_CONCURRENCY: "1" };
  delete env.NOVRA_INLINE_JOBS;
  // node --import tsx keeps the worker in one process, so SIGKILL really kills it (the tsx CLI would leave a child behind).
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/worker/index.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (d) => log.push(String(d)));
  child.stderr!.on("data", (d) => log.push(String(d)));
  children.push(child);
  return child;
}

async function waitFor(what: string, fn: () => Promise<boolean>, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${what}. Worker log:\n${log.join("")}`);
}

beforeAll(async () => {
  delete process.env.NOVRA_INLINE_JOBS; // this test uses the real queue
  await truncateAll();
  await getQueue().obliterate({ force: true });
});
afterAll(async () => {
  for (const c of children) if (c.exitCode === null) c.kill("SIGKILL");
  await getQueue().obliterate({ force: true }).catch(() => undefined);
  await closeQueue();
  await closeDb();
});

describe("worker crash", () => {
  it("resumes a batch after the worker is killed, without duplicates", { timeout: 240_000 }, async () => {
    const { scope, brand } = await makeReadyBrand({}, "Kawi");
    const plan = await generatePlan(scope, brand, { startDate: "2026-12-01", postsCount: 30 });
    await approvePlan(scope, plan.id);
    const items = await approvedPlanItems(scope, plan.id, "2026-12-01", "2026-12-07");
    const job = await prepareBatch(scope, brand, plan.id, items.map((i) => i.id));

    const postCount = async () => (await scope.db.select({ n: count() }).from(masterPosts).where(scope.where(masterPosts)))[0].n;
    let worker = startWorker();
    await waitFor("worker ready", async () => log.join("").includes("[worker] ready"), 60_000);
    await confirmJob(scope, job.id); // puts the job on the BullMQ queue
    await waitFor("first posts", async () => (await postCount()) >= 2, 120_000);

    worker.kill("SIGKILL"); // crash, no graceful shutdown
    await new Promise((r) => worker.once("exit", r));
    const atCrash = await postCount();
    const [mid] = await scope.select(jobs, eq(jobs.id, job.id));
    expect(mid.status).toBe("running");
    expect(atCrash).toBeLessThan(items.length);

    worker = startWorker();
    await waitFor(
      "batch to complete",
      async () => (await scope.select(jobs, eq(jobs.id, job.id)))[0].status === "completed",
      200_000,
    );
    worker.kill("SIGTERM");
    if (process.env.SHOW_WORKER_LOG) console.log(log.join(""));

    const posts = await scope.select(masterPosts);
    expect(posts).toHaveLength(items.length);
    expect(new Set(posts.map((p) => p.planItemId)).size).toBe(items.length);
    const variants = await scope.select(postVariants);
    expect(variants).toHaveLength(items.length * 6);
    expect(new Set(variants.map((v) => `${v.masterPostId}/${v.platform}/${v.language}`)).size).toBe(variants.length);
  });
});
