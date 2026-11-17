import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/brands/service";
import { getDb } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { platformLabel } from "@/lib/platforms";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  await requireUser();
  const t = await getT();
  const list = await listBrands(getDb());
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("brands.title")}</h1>
        <Button asChild>
          <Link href="/brands/new">{t("brands.new")}</Link>
        </Button>
      </div>
      {list.length === 0 && <p className="text-muted-foreground">{t("brands.empty")}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((b) => (
          <Link key={b.id} href={`/brands/${b.id}`}>
            <Card className="h-full transition-colors hover:border-primary">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {b.name} {b.isTest && <Badge variant="warning">{t("brands.test")}</Badge>}
                </CardTitle>
                <CardDescription>
                  {b.languages.map((l) => l.toUpperCase()).join(" + ")} · {b.postsPerMonth} posts / month
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1">
                {b.platforms.map((p) => (
                  <Badge key={p} variant="secondary">
                    {platformLabel(p)}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
