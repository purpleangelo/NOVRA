"use server";

import { revalidatePath } from "next/cache";
import { loadBrand } from "@/lib/brands/load";
import { createExport, ExportError } from "@/lib/export/export";
import type { ActionState } from "./brain";

export async function createExportAction(brandId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { scope, brand } = await loadBrand(brandId);
  try {
    const r = await createExport(scope, brand, String(form.get("from") ?? ""), String(form.get("to") ?? ""));
    revalidatePath(`/brands/${brandId}/export`);
    return { ok: `Export ready: ${r.record.postCount} posts, ${r.rows} platform variants, ${r.record.fileCount} images. Download it below.` };
  } catch (e) {
    if (e instanceof ExportError) return { error: e.message };
    throw e;
  }
}
