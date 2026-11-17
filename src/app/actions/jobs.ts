"use server";

import { revalidatePath } from "next/cache";
import { loadBrand } from "@/lib/brands/load";
import { cancelJob, confirmJob, JobStateError, resumeJob } from "@/lib/jobs/service";
import { BatchError, prepareBatch } from "@/lib/posts/batch";
import type { ActionState } from "./brain";

function refresh(brandId: string) {
  revalidatePath(`/brands/${brandId}`, "layout");
}

export async function prepareBatchAction(brandId: string, planId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { scope, brand } = await loadBrand(brandId);
  try {
    await prepareBatch(scope, brand, planId, form.getAll("items").map(String));
  } catch (e) {
    if (e instanceof BatchError) return { error: e.message };
    throw e;
  }
  refresh(brandId);
  return { ok: "Estimate ready. Check it below and confirm to start." };
}

async function guard(brandId: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof JobStateError) return { error: e.message };
    throw e;
  }
  refresh(brandId);
  return { ok: "Done" };
}

export async function confirmJobAction(brandId: string, jobId: string) {
  const { scope } = await loadBrand(brandId);
  return guard(brandId, () => confirmJob(scope, jobId));
}
export async function cancelJobAction(brandId: string, jobId: string) {
  const { scope } = await loadBrand(brandId);
  return guard(brandId, () => cancelJob(scope, jobId));
}
export async function resumeJobAction(brandId: string, jobId: string) {
  const { scope } = await loadBrand(brandId);
  return guard(brandId, () => resumeJob(scope, jobId));
}
