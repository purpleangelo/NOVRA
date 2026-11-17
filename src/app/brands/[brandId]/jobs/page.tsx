import { desc } from "drizzle-orm";
import { AutoRefresh } from "@/components/auto-refresh";
import { JobCard } from "@/components/job-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadBrand } from "@/lib/brands/load";
import { aiRuns } from "@/lib/db/schema";
import { listJobs } from "@/lib/jobs/service";
import { jobCosts } from "@/lib/usage";

export const dynamic = "force-dynamic";

export default async function JobsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const { scope, brand } = await loadBrand(brandId);
  const [list, costs, runs] = await Promise.all([
    listJobs(scope),
    jobCosts(scope),
    scope.db.select().from(aiRuns).where(scope.where(aiRuns)).orderBy(desc(aiRuns.createdAt)).limit(40),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={list.some((j) => j.status === "running" || j.status === "queued")} />
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {list.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet.</p>}
          {list.map((j) => (
            <JobCard key={j.id} job={j} brandId={brand.id} actualCostUsd={costs.get(j.id)} />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Latest AI runs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1">Time (UTC)</th>
                <th>Role</th>
                <th>Prompt</th>
                <th>Model</th>
                <th>Tokens in/out</th>
                <th>Cost</th>
                <th>Duration</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="py-1">{r.createdAt.toISOString().slice(5, 19).replace("T", " ")}</td>
                  <td>{r.role}</td>
                  <td>{r.promptVersion}</td>
                  <td>{r.model}</td>
                  <td>
                    {r.inputTokens}/{r.outputTokens}
                  </td>
                  <td>${Number(r.costUsd).toFixed(4)}</td>
                  <td>{(r.durationMs / 1000).toFixed(1)}s</td>
                  <td>
                    <Badge variant={r.status === "ok" ? "success" : "destructive"}>{r.status}</Badge>
                    {r.error && <div className="max-w-xs text-destructive">{r.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
