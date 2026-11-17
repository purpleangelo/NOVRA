"use server";

import { revalidatePath } from "next/cache";
import { loadBrand } from "@/lib/brands/load";
import { createEntry, setEntryStatus, updateEntry, ValidationError, bulkSetStatus, type EntryStatus } from "@/lib/brand-brain/service";
import { formToData } from "@/lib/brand-brain/fields";
import { SECTIONS, type Section } from "@/lib/brand-brain/sections";
import { UploadError } from "@/lib/brand-brain/extract";
import { deleteAsset, setPhotoApproval, uploadAsset, uploadDocument, type AssetKind } from "@/lib/brand-brain/uploads";

export type ActionState = { error?: string; ok?: string } | undefined;

const path = (brandId: string) => `/brands/${brandId}/brain`;

export async function saveEntryAction(brandId: string, section: Section, entryId: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { scope } = await loadBrand(brandId);
  if (!SECTIONS.includes(section)) return { error: "Unknown section" };
  try {
    const data = formToData(section, form);
    if (entryId) await updateEntry(scope, entryId, data);
    else await createEntry(scope, { section, data });
  } catch (e) {
    if (e instanceof ValidationError) return { error: e.message };
    throw e;
  }
  revalidatePath(path(brandId));
  return { ok: "Saved" };
}

export async function setEntryStatusAction(brandId: string, entryId: string, status: EntryStatus) {
  const { scope } = await loadBrand(brandId);
  await setEntryStatus(scope, entryId, status);
  revalidatePath(path(brandId));
}

export async function bulkStatusAction(brandId: string, ids: string[], status: EntryStatus) {
  const { scope } = await loadBrand(brandId);
  await bulkSetStatus(scope, ids, status);
  revalidatePath(path(brandId));
}

export async function uploadDocumentsAction(brandId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { scope } = await loadBrand(brandId);
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Choose at least one file." };
  const errors: string[] = [];
  let ok = 0;
  for (const f of files) {
    try {
      await uploadDocument(scope, f.name, Buffer.from(await f.arrayBuffer()));
      ok++;
    } catch (e) {
      if (e instanceof UploadError) errors.push(e.message);
      else throw e;
    }
  }
  if (errors.length) console.warn(`[upload] brand ${brandId}: ${errors.join(" | ")}`);
  revalidatePath(path(brandId));
  return { ok: ok ? `${ok} file(s) uploaded. Reading them in the background; proposals appear below when ready.` : undefined, error: errors.join(" ") || undefined };
}

export async function uploadAssetAction(brandId: string, kind: AssetKind, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { scope } = await loadBrand(brandId);
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Choose at least one file." };
  const errors: string[] = [];
  for (const f of files) {
    try {
      await uploadAsset(scope, kind, f.name, Buffer.from(await f.arrayBuffer()), kind === "font" ? { family: String(form.get("family") || f.name.replace(/\.[^.]+$/, "")) } : {});
    } catch (e) {
      if (e instanceof UploadError) errors.push(e.message);
      else throw e;
    }
  }
  if (errors.length) console.warn(`[upload] brand ${brandId}: ${errors.join(" | ")}`);
  revalidatePath(path(brandId));
  return errors.length ? { error: errors.join(" ") } : { ok: "Uploaded" };
}

export async function photoApprovalAction(brandId: string, assetId: string, approved: boolean) {
  const { scope } = await loadBrand(brandId);
  await setPhotoApproval(scope, assetId, approved);
  revalidatePath(path(brandId));
}

export async function deleteAssetAction(brandId: string, assetId: string) {
  const { scope } = await loadBrand(brandId);
  await deleteAsset(scope, assetId);
  revalidatePath(path(brandId));
}
