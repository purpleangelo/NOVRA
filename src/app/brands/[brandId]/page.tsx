import { loadBrand } from "@/lib/brands/load";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function BrandOverviewPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const { brand } = await loadBrand(brandId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {brand.name}: Brand Brain → content plan → produce a batch → review → export.
      </CardContent>
    </Card>
  );
}
