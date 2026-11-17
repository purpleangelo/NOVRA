import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { BrandScope } from "../brands/scope";
import type { DB } from "../db";
import { brandBrainEntries, brands, contentPlans, masterPosts, planItems } from "../db/schema";
import { runRole } from "../ai/run";
import { brainForPrompt, brainIntegrity, createEntry, setEntryStatus } from "../brand-brain/service";
import { platformLabel } from "../platforms";

export const FORMATS = ["short_video", "carousel", "single_image"] as const;
export const GOALS = ["awareness", "engagement", "leads"] as const;
export type Format = (typeof FORMATS)[number];
export type Plan = typeof contentPlans.$inferSelect;
export type PlanItem = typeof planItems.$inferSelect;
type Brand = typeof brands.$inferSelect;

export class PlanError extends Error {}

export const strategistSchema = z.object({
  pillars: z.array(z.object({ name: z.string().min(1).max(120), description: z.string().max(500) })).min(1).max(6),
  rows: z.array(z.object({ pillar: z.string().min(1), format: z.enum(FORMATS), angle: z.string().min(5).max(400), goal: z.enum(GOALS) })),
});
export type StrategistOutput = z.infer<typeof strategistSchema>;

export const itemInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  pillar: z.string().trim().min(1).max(120),
  format: z.enum(FORMATS),
  angle: z.string().trim().min(5, "Angle must be one sentence").max(400),
  goal: z.enum(GOALS),
});

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Spread `count` posts over `days` days, in order. 30 posts / 30 days = one a day; 60 = two a day. */
export function spreadDates(start: string, days: number, count: number) {
  return Array.from({ length: count }, (_, i) => addDays(start, Math.floor((i * days) / count)));
}

/** Target number of rows per format for a given mix (largest-remainder rounding). */
export function mixTargets(mix: Record<string, number>, count: number): Record<Format, number> {
  const total = FORMATS.reduce((a, f) => a + (mix[f] ?? 0), 0) || 1;
  const raw = FORMATS.map((f) => ((mix[f] ?? 0) / total) * count);
  const base = raw.map(Math.floor);
  let left = count - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) if (left-- > 0) base[i]++;
  return Object.fromEntries(FORMATS.map((f, i) => [f, base[i]])) as Record<Format, number>;
}

type Row = { pillar: string; format: Format; angle: string; goal: (typeof GOALS)[number] };
const same = (a: Row, b: Row) => a.pillar.toLowerCase() === b.pillar.toLowerCase() && a.format === b.format;

/** Indexes i where row i repeats pillar+format of row i-1. */
export function consecutiveViolations(rows: Pick<Row, "pillar" | "format">[]) {
  const out: number[] = [];
  for (let i = 1; i < rows.length; i++) if (same(rows[i] as Row, rows[i - 1] as Row)) out.push(i);
  return out;
}

/**
 * Makes the Strategist's rows obey the plan rules: exact count, format mix and no two consecutive rows with the
 * same pillar and format. Angles and pillars are kept; only formats are reassigned and rows reordered.
 */
export function enforcePlanRules(input: Row[], count: number, mix: Record<string, number>): Row[] {
  if (input.length === 0) throw new PlanError("The Strategist returned no rows.");
  const rows = Array.from({ length: count }, (_, i) => ({ ...input[i % input.length] }));
  // 1. format mix
  const target = mixTargets(mix, count);
  const have = (f: Format) => rows.filter((r) => r.format === f).length;
  for (const f of FORMATS) {
    while (have(f) > target[f]) {
      const deficit = FORMATS.find((g) => have(g) < target[g]);
      if (!deficit) break;
      const idx = rows.map((r, i) => [r, i] as const).filter(([r]) => r.format === f).pop()![1];
      rows[idx].format = deficit;
    }
  }
  // 2. no consecutive pillar+format: swap the offending row with a later row that fits
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < rows.length; i++) {
      if (!same(rows[i], rows[i - 1])) continue;
      const fits = (j: number) => !same(rows[j], rows[i - 1]) && (i + 1 >= rows.length || !same(rows[j], rows[i + 1])) && !same(rows[i], rows[j - 1] ?? ({} as Row)) && (j + 1 >= rows.length || !same(rows[i], rows[j + 1]));
      let j = rows.findIndex((_, k) => k > i && fits(k));
      if (j < 0) j = rows.findIndex((_, k) => k < i - 1 && k > 0 && fits(k));
      if (j >= 0) [rows[i], rows[j]] = [rows[j], rows[i]];
    }
  }
  return rows;
}

export async function listPlans(scope: BrandScope) {
  return scope.db.select().from(contentPlans).where(scope.where(contentPlans)).orderBy(desc(contentPlans.createdAt));
}

export async function getPlan(scope: BrandScope, planId: string) {
  const plan = await scope.get(contentPlans, planId);
  const items = await scope.db
    .select()
    .from(planItems)
    .where(scope.where(planItems, eq(planItems.planId, planId)))
    .orderBy(asc(planItems.date), asc(planItems.position));
  return { plan, items };
}

export async function latestPlan(scope: BrandScope) {
  const [p] = await scope.db
    .select()
    .from(contentPlans)
    .where(scope.where(contentPlans, inArray(contentPlans.status, ["draft", "approved"])))
    .orderBy(desc(contentPlans.createdAt))
    .limit(1);
  return p ?? null;
}

/** Runs the Strategist and stores a draft plan with its rows; pillars are proposed into the Brand Brain. */
export async function generatePlan(scope: BrandScope, brand: Brand, opts: { startDate: string; postsCount?: number; days?: number; notes?: string; jobId?: string | null }) {
  const integrity = await brainIntegrity(scope);
  if (!integrity.readyForPlanning)
    throw new PlanError(`Brand Brain is not ready: ${[...integrity.missing.map((m) => m.label), ...integrity.conflicts.map((c) => c.message)].join("; ")}`);
  const count = opts.postsCount ?? brand.postsPerMonth;
  if (count < 20 || count > 60) throw new PlanError("Posts per month must be between 20 and 60.");
  const days = opts.days ?? 30;
  const brain = await brainForPrompt(scope);
  const existingPillars = brain.entries.filter((e) => e.section === "pillar").map((e) => ({ name: String(e.data.name), description: String(e.data.description ?? "") }));
  const out = await runRole({
    scope,
    jobId: opts.jobId,
    role: "strategist",
    prompt: "strategist",
    vars: {
      brand_name: brand.name,
      platforms: brand.platforms.map(platformLabel).join(", "),
      languages: brand.languages.map((l) => (l === "id" ? "Indonesian" : "English")).join(" and "),
      brain: brain.text,
      posts_count: String(count),
      format_mix: brand.formatMix,
      start_date: opts.startDate,
      days: String(days),
      operator_notes: opts.notes ? `Operator notes: ${opts.notes}` : "",
    },
    schema: strategistSchema,
    mock: () => mockStrategist(brain.entries, count, existingPillars),
  });
  const rows = enforcePlanRules(out.rows, count, brand.formatMix);
  const dates = spreadDates(opts.startDate, days, count);

  return scope.db.transaction(async (tx) => {
    const txScope = new BrandScope(tx as unknown as DB, scope.brandId);
    // a new draft replaces older drafts
    await txScope.update(contentPlans, { status: "archived", updatedAt: new Date() }, eq(contentPlans.status, "draft"));
    const [plan] = await txScope.insert(contentPlans, { startDate: opts.startDate, days, postsCount: count, status: "draft", formatMix: brand.formatMix, pillars: out.pillars });
    await txScope.insert(
      planItems,
      rows.map((r, i) => ({ planId: plan.id, date: dates[i], position: i, pillar: r.pillar, format: r.format, angle: r.angle, goal: r.goal })),
    );
    return plan;
  });
}

async function assertDraft(scope: BrandScope, planId: string) {
  const plan = await scope.get(contentPlans, planId);
  if (plan.status !== "draft") throw new PlanError("Only a draft plan can be edited. Approved plans are locked; generate a new plan to change direction.");
  return plan;
}

export async function updateItem(scope: BrandScope, itemId: string, input: z.input<typeof itemInputSchema>) {
  const item = await scope.get(planItems, itemId);
  await assertDraft(scope, item.planId);
  const data = itemInputSchema.parse(input);
  const [row] = await scope.update(planItems, data, eq(planItems.id, itemId));
  return row;
}

export async function addItem(scope: BrandScope, planId: string, input: z.input<typeof itemInputSchema>) {
  const plan = await assertDraft(scope, planId);
  const data = itemInputSchema.parse(input);
  const { items } = await getPlan(scope, planId);
  if (items.length >= 60) throw new PlanError("A plan can have at most 60 posts.");
  const [row] = await scope.insert(planItems, { planId: plan.id, position: Math.max(-1, ...items.map((i) => i.position)) + 1, ...data });
  return row;
}

export async function deleteItem(scope: BrandScope, itemId: string) {
  const item = await scope.get(planItems, itemId);
  await assertDraft(scope, item.planId);
  await scope.delete(planItems, eq(planItems.id, itemId));
}

/** Reorder: swap a row's content with the previous/next row; dates stay where they are. */
export async function moveItem(scope: BrandScope, itemId: string, dir: "up" | "down") {
  const item = await scope.get(planItems, itemId);
  await assertDraft(scope, item.planId);
  const { items } = await getPlan(scope, item.planId);
  const idx = items.findIndex((i) => i.id === itemId);
  const other = items[dir === "up" ? idx - 1 : idx + 1];
  if (!other) return;
  const pick = (i: PlanItem) => ({ pillar: i.pillar, format: i.format, angle: i.angle, goal: i.goal });
  await scope.update(planItems, pick(other), eq(planItems.id, item.id));
  await scope.update(planItems, pick(item), eq(planItems.id, other.id));
}

export function planWarnings(plan: Plan, items: PlanItem[]) {
  const warnings: string[] = [];
  const ordered = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);
  for (const i of consecutiveViolations(ordered as Row[])) warnings.push(`${ordered[i].date}: same pillar and format as the post before it`);
  if (items.length < 20) warnings.push(`Only ${items.length} posts (minimum 20)`);
  const target = mixTargets(plan.formatMix, items.length);
  for (const f of FORMATS) {
    const n = items.filter((i) => i.format === f).length;
    if (Math.abs(n - target[f]) > Math.max(2, items.length * 0.1)) warnings.push(`${f.replace("_", " ")}: ${n} posts, mix target is about ${target[f]}`);
  }
  return warnings;
}

/** Approves the plan. Its pillars are stored in the Brand Brain as approved entries. */
export async function approvePlan(scope: BrandScope, planId: string) {
  const plan = await assertDraft(scope, planId);
  const { items } = await getPlan(scope, planId);
  if (items.length === 0) throw new PlanError("The plan has no posts.");
  const usedPillars = new Set(items.map((i) => i.pillar.toLowerCase()));
  const existing = await scope.select(brandBrainEntries, eq(brandBrainEntries.section, "pillar"));
  for (const p of plan.pillars.filter((p) => usedPillars.has(p.name.toLowerCase()))) {
    const match = existing.find((e) => e.title.toLowerCase() === p.name.toLowerCase());
    if (match) {
      if (match.status !== "approved") await setEntryStatus(scope, match.id, "approved");
    } else {
      await createEntry(scope, { section: "pillar", data: p, sourceKind: "strategist", status: "approved" });
    }
  }
  // any other approved plan overlapping the same start is archived so only one plan drives production
  await scope.update(contentPlans, { status: "archived", updatedAt: new Date() }, and(eq(contentPlans.status, "approved"), eq(contentPlans.startDate, plan.startDate)));
  const [approved] = await scope.update(contentPlans, { status: "approved", approvedAt: new Date(), updatedAt: new Date() }, eq(contentPlans.id, planId));
  return approved;
}

export async function planHasPosts(scope: BrandScope, planId: string) {
  const ids = (await scope.select(planItems, eq(planItems.planId, planId))).map((i) => i.id);
  if (!ids.length) return false;
  return (await scope.select(masterPosts, inArray(masterPosts.planItemId, ids))).length > 0;
}

/** TEST-mode Strategist: cycles pillars and formats, angles reference approved Brand Brain titles. */
function mockStrategist(entries: { section: string; title: string }[], count: number, existing: { name: string; description: string }[]): StrategistOutput {
  const products = entries.filter((e) => e.section === "product").map((e) => e.title);
  const personas = entries.filter((e) => e.section === "audience").map((e) => e.title);
  const pillars = existing.length
    ? existing
    : [
        { name: "Product focus", description: "[TEST] Show what the products are and how they are used." },
        { name: "Behind the scenes", description: "[TEST] How the brand works, people and process." },
        { name: "Education", description: "[TEST] Useful tips for the audience." },
        { name: "Community", description: "[TEST] Customers, questions and conversations." },
      ];
  const formats: Format[] = ["short_video", "carousel", "single_image", "short_video", "carousel"];
  const goals = ["awareness", "engagement", "awareness", "leads", "engagement"] as const;
  return {
    pillars,
    rows: Array.from({ length: count }, (_, i) => ({
      pillar: pillars[i % pillars.length].name,
      format: formats[i % formats.length],
      angle: `[TEST] ${pillars[i % pillars.length].name}: ${products[i % Math.max(1, products.length)] ?? "the brand"} for ${personas[i % Math.max(1, personas.length)] ?? "our audience"} (idea ${i + 1}).`,
      goal: goals[i % goals.length],
    })),
  };
}
