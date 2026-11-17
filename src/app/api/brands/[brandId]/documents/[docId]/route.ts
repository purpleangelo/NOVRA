import { z } from "zod";
import { apiBrand, fileResponse, handleApiError, HttpError } from "@/lib/api";
import { documents } from "@/lib/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ brandId: string; docId: string }> }) {
  try {
    const { brandId, docId } = await params;
    if (!z.string().uuid().safeParse(docId).success) throw new HttpError(404, "Not found");
    const { scope } = await apiBrand(brandId);
    const d = await scope.get(documents, docId);
    return await fileResponse(brandId, d.storageKey, d.mimeType, d.fileName, true);
  } catch (e) {
    return handleApiError(e);
  }
}
