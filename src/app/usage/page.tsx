import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { usageByBrand } from "@/lib/usage";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  await requireUser();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [month, all] = await Promise.all([usageByBrand(getDb(), monthStart), usageByBrand(getDb(), new Date(0))]);
  const allById = new Map(all.map((r) => [r.brandId, r]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage and cost per brand</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1">Brand</th>
              <th>Text tokens (this month)</th>
              <th>Images (this month)</th>
              <th>Cost this month</th>
              <th>Cost all time</th>
            </tr>
          </thead>
          <tbody>
            {month.map((r) => (
              <tr key={r.brandId} className="border-t">
                <td className="py-1.5">
                  {r.brand} {r.isTest && <Badge variant="warning">TEST</Badge>}
                </td>
                <td>{Number(r.textUnits).toLocaleString()}</td>
                <td>{Number(r.images)}</td>
                <td>${Number(r.cost).toFixed(2)}</td>
                <td>${Number(allById.get(r.brandId)?.cost ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">Costs are computed from token counts and the price table in src/lib/ai/provider.ts, plus FAL_COST_PER_IMAGE per generated image. Check your provider invoices for exact billing.</p>
      </CardContent>
    </Card>
  );
}
