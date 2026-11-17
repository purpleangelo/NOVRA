import { z } from "zod";
import { apiBrand, fileResponse, handleApiError, HttpError } from "@/lib/api";
import { exportsTable } from "@/lib/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ brandId: string; exportId: string }> }) {
  try {
    const { brandId, exportId } = await params;
    if (!z.string().uuid().safeParse(exportId).success) throw new HttpError(404, "Not found");
    const { scope } = await apiBrand(brandId);
    const e = await scope.get(exportsTable, exportId);
    if (!e.storageKey) throw new HttpError(404, "Not found");
    return await fileResponse(brandId, e.storageKey, "application/zip", e.storageKey.split("/").pop() ?? "export.zip", true);
  } catch (e) {
    return handleApiError(e);
  }
}
