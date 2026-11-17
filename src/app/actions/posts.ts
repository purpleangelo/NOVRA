"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { loadBrand } from "@/lib/brands/load";
import {
  approveCleanPosts,
  approvePost,
  approveVariant,
  editVariant,
  rejectPost,
  requestRegenerateCopy,
  requestRegenerateImage,
  ReviewError,
  setPostImageSource,
} from "@/lib/posts/review";
import type { ActionState } from "./brain";

const refresh = (brandId: string) => revalidatePath(`/brands/${brandId}`, "layout");

async function guard(brandId: string, fn: () => Promise<unknown>, ok = "Saved"): Promise<ActionState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ReviewError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    throw e;
  }
  refresh(brandId);
  return { ok };
}

export async function editVariantAction(brandId: string, variantId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const { scope, brand } = await loadBrand(brandId);
  const opt = (k: string) => (form.has(k) ? String(form.get(k)) : undefined);
  return guard(
    brandId,
    () =>
      editVariant(
        scope,
        brand,
        variantId,
        { hook: String(form.get("hook") ?? ""), caption: String(form.get("caption") ?? ""), hashtags: String(form.get("hashtags") ?? ""), cta: String(form.get("cta") ?? ""), title: opt("title"), headline: opt("headline"), subtext: opt("subtext"), slides: opt("slides") },
        user.id,
      ),
    "Saved as a new version. Re-rendering…",
  );
}

export async function regenerateAction(brandId: string, variantId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { scope } = await loadBrand(brandId);
  const kind = form.get("kind");
  const instruction = String(form.get("instruction") ?? "");
  return guard(brandId, () => (kind === "image" ? requestRegenerateImage(scope, variantId, instruction) : requestRegenerateCopy(scope, variantId, instruction)), "Queued. This page updates when it is done.");
}

export async function approveVariantAction(brandId: string, variantId: string) {
  const user = await requireUser();
  const { scope } = await loadBrand(brandId);
  return guard(brandId, () => approveVariant(scope, variantId, user.id));
}

export async function approvePostAction(brandId: string, masterId: string, _prev: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const { scope } = await loadBrand(brandId);
  return guard(brandId, () => approvePost(scope, masterId, user.id), "Post approved");
}

export async function rejectPostAction(brandId: string, masterId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const { scope } = await loadBrand(brandId);
  return guard(brandId, () => rejectPost(scope, masterId, String(form.get("reason") ?? ""), user.id), "Post rejected");
}

export async function imageSourceAction(brandId: string, masterId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { scope } = await loadBrand(brandId);
  const source = z.enum(["generated", "brand_photo", "plain"]).parse(form.get("source"));
  return guard(brandId, () => setPostImageSource(scope, masterId, source), "Re-rendering with the new image source…");
}

export async function approveCleanAction(brandId: string, from: string, to: string, _prev: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const { scope } = await loadBrand(brandId);
  let n = 0;
  const r = await guard(brandId, async () => (n = await approveCleanPosts(scope, from, to, user.id)));
  return r?.error ? r : { ok: `${n} post(s) approved. Posts with flagged claims still need your review.` };
}
