"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { brandInputSchema, createBrand, updateBrand } from "@/lib/brands/service";
import { getDb } from "@/lib/db";

export type FormState = { error?: string; ok?: boolean } | undefined;

function parseBrandForm(form: FormData) {
  return brandInputSchema.safeParse({
    name: form.get("name"),
    languages: form.getAll("languages"),
    platforms: form.getAll("platforms"),
    postsPerMonth: form.get("postsPerMonth"),
    imageSource: form.get("imageSource"),
    formatMix: {
      short_video: Number(form.get("mix_short_video")),
      carousel: Number(form.get("mix_carousel")),
      single_image: Number(form.get("mix_single_image")),
    },
    isTest: form.get("isTest") === "on",
  });
}

const issueText = (e: z.ZodError) => e.issues.map((i) => i.message).join(" ");

export async function createBrandAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseBrandForm(form);
  if (!parsed.success) return { error: issueText(parsed.error) };
  const brand = await createBrand(getDb(), parsed.data);
  revalidatePath("/brands");
  redirect(`/brands/${brand.id}`);
}

export async function updateBrandAction(brandId: string, _prev: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseBrandForm(form);
  if (!parsed.success) return { error: issueText(parsed.error) };
  await updateBrand(getDb(), brandId, parsed.data);
  revalidatePath(`/brands/${brandId}`, "layout");
  return { ok: true };
}
