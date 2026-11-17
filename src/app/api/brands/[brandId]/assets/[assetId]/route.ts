import { z } from "zod";
import { apiBrand, fileResponse, handleApiError, HttpError } from "@/lib/api";
import { assets } from "@/lib/db/schema";

export async function GET(req: Request, { params }: { params: Promise<{ brandId: string; assetId: string }> }) {
  try {
    const { brandId, assetId } = await params;
    if (!z.string().uuid().safeParse(assetId).success) throw new HttpError(404, "Not found");
    const { scope } = await apiBrand(brandId);
    const a = await scope.get(assets, assetId);
    return await fileResponse(brandId, a.storageKey, a.mimeType, a.fileName, new URL(req.url).searchParams.has("download"));
  } catch (e) {
    return handleApiError(e);
  }
}
