import { apiBrand, handleApiError } from "@/lib/api";
import { brainMarkdown } from "@/lib/brand-brain/service";
import { slugify } from "@/lib/brands/service";

export async function GET(_req: Request, { params }: { params: Promise<{ brandId: string }> }) {
  try {
    const { brandId } = await params;
    const { scope, brand } = await apiBrand(brandId);
    const md = await brainMarkdown(scope, brand.name);
    return new Response(md, {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${slugify(brand.name)}-brand-brain.md"` },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
