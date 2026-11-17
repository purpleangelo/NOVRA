import { BrandNav } from "@/components/brand-nav";
import { Badge } from "@/components/ui/badge";
import { loadBrand } from "@/lib/brands/load";
import { getT } from "@/lib/i18n/server";

export default async function BrandLayout({ children, params }: { children: React.ReactNode; params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const { brand } = await loadBrand(brandId);
  const t = await getT();
  const items = [
    { href: "", label: t("nav.overview") },
    { href: "/brain", label: t("nav.brain") },
    { href: "/plan", label: t("nav.plan") },
    { href: "/produce", label: t("nav.produce") },
    { href: "/calendar", label: t("nav.calendar") },
    { href: "/grid", label: t("nav.grid") },
    { href: "/export", label: t("nav.export") },
    { href: "/jobs", label: t("nav.jobs") },
    { href: "/settings", label: t("nav.settings") },
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{brand.name}</h1>
        {brand.isTest && <Badge variant="warning">TEST</Badge>}
      </div>
      <BrandNav base={`/brands/${brand.id}`} items={items} />
      <div>{children}</div>
    </div>
  );
}
