import { createBrandAction } from "@/app/actions/brands";
import { BrandForm } from "@/components/brand-form";
import { requireUser } from "@/lib/auth/session";
import { brandFormLabels } from "@/lib/i18n/brand-form-labels";
import { getT } from "@/lib/i18n/server";
import { PLATFORMS, platformLabel } from "@/lib/platforms";

export default async function NewBrandPage() {
  await requireUser();
  const t = await getT();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("brands.new")}</h1>
      <BrandForm action={createBrandAction} labels={brandFormLabels(t, t("brand.create"))} platforms={PLATFORMS.map((id) => ({ id, label: platformLabel(id) }))} />
    </div>
  );
}
