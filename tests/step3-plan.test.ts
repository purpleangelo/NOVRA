import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/lib/db";
import { brandBrainEntries, contentPlans, jobs } from "@/lib/db/schema";
import {
  addItem,
  approvePlan,
  consecutiveViolations,
  deleteItem,
  enforcePlanRules,
  generatePlan,
  getPlan,
  mixTargets,
  moveItem,
  PlanError,
  planWarnings,
  spreadDates,
  updateItem,
} from "@/lib/plans/service";
import { createJob } from "@/lib/jobs/service";
import { registerAllHandlers } from "@/lib/jobs/handlers";
import { runJob } from "@/lib/jobs/run";
import { brandScope } from "@/lib/brands/scope";
import { db, makeBrand, truncateAll } from "./helpers";
import { makeReadyBrand } from "./brain-fixture";

process.env.NOVRA_INLINE_JOBS = "1";
beforeAll(() => registerAllHandlers());
beforeEach(truncateAll);
afterAll(closeDb);

describe("plan rules", () => {
  it("spreads posts over the month", () => {
    expect(spreadDates("2026-12-01", 30, 30)).toHaveLength(30);
    expect(spreadDates("2026-12-01", 30, 30)[29]).toBe("2026-12-30");
    const twenty = spreadDates("2026-12-01", 30, 20);
    expect(new Set(twenty).size).toBe(20);
    const sixty = spreadDates("2026-12-01", 30, 60);
    expect(new Set(sixty).size).toBe(30);
  });

  it("enforces count, format mix and no consecutive pillar+format", () => {
    const bad = Array.from({ length: 10 }, (_, i) => ({ pillar: i % 2 ? "A" : "B", format: "carousel" as const, angle: `angle ${i}`, goal: "awareness" as const }));
    const rows = enforcePlanRules(bad, 30, { short_video: 40, carousel: 30, single_image: 30 });
    expect(rows).toHaveLength(30);
    expect(rows.filter((r) => r.format === "short_video")).toHaveLength(12);
    expect(rows.filter((r) => r.format === "carousel")).toHaveLength(9);
    expect(consecutiveViolations(rows)).toEqual([]);
    expect(mixTargets({ short_video: 40, carousel: 30, single_image: 30 }, 25)).toEqual({ short_video: 10, carousel: 8, single_image: 7 });
  });
});

describe("content plan", () => {
  it("refuses to plan while the Brand Brain is incomplete", async () => {
    const brand = await makeBrand();
    const { scope } = await brandScope(db(), brand.id);
    await expect(generatePlan(scope, brand, { startDate: "2026-12-01" })).rejects.toThrow(/not ready.*Company basics/);
  });

  it("generates a 30-day plan via a job, allows editing, and approval stores pillars", async () => {
    const { brand, scope } = await makeReadyBrand();
    const job = await createJob(scope, "generate_plan", { startDate: "2026-12-01", postsCount: 30 }, { autoStart: true });
    await runJob(job.id, brand.id);
    const [j] = await scope.select(jobs, eq(jobs.id, job.id));
    expect(j.status).toBe("completed");
    const planId = JSON.parse(j.progress.message!).planId as string;
    const { plan, items } = await getPlan(scope, planId);
    expect(plan.status).toBe("draft");
    expect(items).toHaveLength(30);
    expect(items[0].date).toBe("2026-12-01");
    expect(items[29].date).toBe("2026-12-30");
    expect(planWarnings(plan, items)).toEqual([]);
    expect(items.filter((i) => i.format === "short_video")).toHaveLength(12);

    // edit, add, delete, reorder
    await updateItem(scope, items[0].id, { date: "2026-12-01", pillar: "Education", format: "single_image", angle: "How to store beans at home.", goal: "engagement" });
    await expect(updateItem(scope, items[0].id, { date: "bad", pillar: "x", format: "single_image", angle: "short", goal: "leads" })).rejects.toThrow();
    const added = await addItem(scope, planId, { date: "2026-12-31", pillar: "Community", format: "carousel", angle: "Year-end thank you to customers.", goal: "engagement" });
    await deleteItem(scope, items[5].id);
    await moveItem(scope, items[0].id, "down");
    const after = await getPlan(scope, planId);
    expect(after.items).toHaveLength(30);
    expect(after.items[1].angle).toBe("How to store beans at home.");
    expect(after.items.at(-1)!.id).toBe(added.id);

    const approved = await approvePlan(scope, planId);
    expect(approved.status).toBe("approved");
    const pillars = await scope.select(brandBrainEntries, eq(brandBrainEntries.section, "pillar"));
    expect(pillars.length).toBeGreaterThanOrEqual(3);
    expect(pillars.every((p) => p.status === "approved" && p.sourceKind === "strategist")).toBe(true);
    // approved plans are locked
    await expect(deleteItem(scope, after.items[0].id)).rejects.toBeInstanceOf(PlanError);
  });

  it("a new draft archives the previous draft; plan rows never leak across brands", async () => {
    const { brand, scope } = await makeReadyBrand({}, "A");
    const { scope: sb } = await makeReadyBrand({}, "B");
    const p1 = await generatePlan(scope, brand, { startDate: "2026-12-01", postsCount: 20 });
    const p2 = await generatePlan(scope, brand, { startDate: "2026-12-01", postsCount: 20 });
    const all = await scope.select(contentPlans);
    expect(all.find((p) => p.id === p1.id)!.status).toBe("archived");
    expect(all.find((p) => p.id === p2.id)!.status).toBe("draft");
    expect(await sb.select(contentPlans)).toHaveLength(0);
    const { items } = await getPlan(scope, p2.id);
    expect(items.some((i) => i.angle.includes("B Gayo"))).toBe(false);
    expect(items.some((i) => i.angle.includes("A Gayo") || i.angle.includes("A Toraja"))).toBe(true);
  });
});
