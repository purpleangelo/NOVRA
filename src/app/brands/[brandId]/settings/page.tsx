import { updateBrandAction } from "@/app/actions/brands";
import { BrandForm } from "@/components/brand-form";
import { loadBrand } from "@/lib/brands/load";
import { brandFormLabels } from "@/lib/i18n/brand-form-labels";
import { getT } from "@/lib/i18n/server";
import { PLATFORMS, platformLabel } from "@/lib/platforms";

export default async function BrandSettingsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const { brand } = await loadBrand(brandId);
  const t = await getT();
  return (
    <BrandForm
      action={updateBrandAction.bind(null, brand.id)}
      initial={brand}
      labels={brandFormLabels(t, t("brand.save"))}
      platforms={PLATFORMS.map((id) => ({ id, label: platformLabel(id) }))}
    />
  );
}
