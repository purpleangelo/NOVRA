"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { loadBrand } from "@/lib/brands/load";
import { brainIntegrity } from "@/lib/brand-brain/service";
import { createJob } from "@/lib/jobs/service";
import { addItem, approvePlan, deleteItem, moveItem, PlanError, updateItem } from "@/lib/plans/service";
import type { ActionState } from "./brain";

const p = (brandId: string) => `/brands/${brandId}/plan`;

const genSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  postsCount: z.coerce.number().int().min(20).max(60),
  notes: z.string().max(2000).optional(),
});

export async function generatePlanAction(brandId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { scope } = await loadBrand(brandId);
  const parsed = genSchema.safeParse({ startDate: form.get("startDate"), postsCount: form.get("postsCount"), notes: form.get("notes") || undefined });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const integ = await brainIntegrity(scope);
  if (!integ.readyForPlanning) return { error: "Brand Brain is not ready for planning yet." };
  await createJob(scope, "generate_plan", parsed.data, {
    autoStart: true,
    estimate: { aiCalls: 1, imageGenerations: 0, estimatedCostUsd: 0.15, notes: ["One Strategist call"] },
  });
  revalidatePath(p(brandId));
  return { ok: "The Strategist is planning the month. This page refreshes when the plan is ready." };
}

function itemFromForm(form: FormData) {
  return {
    date: String(form.get("date") ?? ""),
    pillar: String(form.get("pillar") ?? ""),
    format: String(form.get("format") ?? "") as "carousel",
    angle: String(form.get("angle") ?? ""),
    goal: String(form.get("goal") ?? "") as "awareness",
  };
}

async function guard(fn: () => Promise<unknown>): Promise<ActionState> {
  try {
    await fn();
    return { ok: "Saved" };
  } catch (e) {
    if (e instanceof PlanError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => i.message).join("; ") };
    throw e;
  }
}

export async function updateItemAction(brandId: string, itemId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { scope } = await loadBrand(brandId);
  const r = await guard(() => updateItem(scope, itemId, itemFromForm(form)));
  revalidatePath(p(brandId));
  return r;
}

export async function addItemAction(brandId: string, planId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { scope } = await loadBrand(brandId);
  const r = await guard(() => addItem(scope, planId, itemFromForm(form)));
  revalidatePath(p(brandId));
  return r;
}

export async function deleteItemAction(brandId: string, itemId: string) {
  const { scope } = await loadBrand(brandId);
  await deleteItem(scope, itemId);
  revalidatePath(p(brandId));
}

export async function moveItemAction(brandId: string, itemId: string, dir: "up" | "down") {
  const { scope } = await loadBrand(brandId);
  await moveItem(scope, itemId, dir);
  revalidatePath(p(brandId));
}

export async function approvePlanAction(brandId: string, planId: string, _prev: ActionState): Promise<ActionState> {
  const { scope } = await loadBrand(brandId);
  const r = await guard(() => approvePlan(scope, planId));
  revalidatePath(p(brandId));
  return r?.error ? r : { ok: "Plan approved. Go to Produce to make a batch." };
}
