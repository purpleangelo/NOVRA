import { inArray } from "drizzle-orm";
import { createExportAction } from "@/app/actions/exports";
import { FormAction } from "@/components/form-action";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { loadBrand } from "@/lib/brands/load";
import { masterPosts } from "@/lib/db/schema";
import { listExports } from "@/lib/export/export";

export const dynamic = "force-dynamic";

export default async function ExportPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const { scope, brand } = await loadBrand(brandId);
  const [approved, past] = await Promise.all([
    scope.db.select({ date: masterPosts.date, status: masterPosts.status }).from(masterPosts).where(scope.where(masterPosts, inArray(masterPosts.status, ["approved", "exported"]))).orderBy(masterPosts.date),
    listExports(scope),
  ]);
  const waiting = approved.filter((p) => p.status === "approved");
  const from = (waiting[0] ?? approved[0])?.date ?? new Date().toISOString().slice(0, 10);
  const to = (waiting.at(-1) ?? approved.at(-1))?.date ?? from;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Export for a scheduler</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Builds a ZIP with one folder per date and platform (images, carousel slides in order, captions, storyboards as text), a Metricool bulk-upload CSV and a generic CSV.
            Only approved posts are included. {waiting.length} approved post{waiting.length === 1 ? "" : "s"} not yet exported.
          </p>
          <FormAction action={createExportAction.bind(null, brand.id)} label="Create export">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="from">From</Label>
                <Input id="from" name="from" type="date" defaultValue={from} required />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="to">To</Label>
                <Input id="to" name="to" type="date" defaultValue={to} required />
              </div>
            </div>
          </FormAction>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Past exports</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {past.length === 0 ? (
            <p className="text-muted-foreground">No exports yet.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="export-list">
              {past.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 border-b pb-2">
                  <span className="font-medium">
                    {e.fromDate} to {e.toDate}
                  </span>
                  <span className="text-muted-foreground">
                    {e.postCount} posts · {e.fileCount} images · {e.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  </span>
                  {e.storageKey && (
                    <a className="underline" href={`/api/brands/${brand.id}/exports/${e.id}`}>
                      Download ZIP
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
