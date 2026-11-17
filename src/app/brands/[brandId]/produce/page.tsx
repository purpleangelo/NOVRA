import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { prepareBatchAction } from "@/app/actions/jobs";
import { AutoRefresh } from "@/components/auto-refresh";
import { FormAction } from "@/components/form-action";
import { JobCard } from "@/components/job-card";
import { Alert, Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { aiStatus } from "@/lib/ai/provider";
import { loadBrand } from "@/lib/brands/load";
import { contentPlans, jobs, masterPosts } from "@/lib/db/schema";
import { approvedPlanItems } from "@/lib/posts/batch";
import { imageProviderStatus } from "@/lib/render/image-provider";
import { jobCosts } from "@/lib/usage";

export const dynamic = "force-dynamic";

export default async function ProducePage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const { scope, brand } = await loadBrand(brandId);
  const [plan] = await scope.db
    .select()
    .from(contentPlans)
    .where(scope.where(contentPlans, eq(contentPlans.status, "approved")))
    .orderBy(desc(contentPlans.approvedAt))
    .limit(1);
  const batchJobs = (await scope.select(jobs, eq(jobs.type, "produce_batch"))).sort((a, b) => +b.createdAt - +a.createdAt).slice(0, 5);
  const costs = await jobCosts(scope);
  const active = batchJobs.some((j) => j.status === "running" || j.status === "queued");
  const ai = aiStatus();
  const img = imageProviderStatus();
  const base = `/brands/${brand.id}`;

  if (!plan)
    return (
      <Alert variant="warning">
        No approved content plan yet.{" "}
        <Link href={`${base}/plan`} className="underline">
          Plan and approve a month first.
        </Link>
      </Alert>
    );

  const items = await approvedPlanItems(scope, plan.id);
  const posts = await scope.select(masterPosts);
  const byItem = new Map(posts.map((p) => [p.planItemId, p]));
  const firstOpen = items.findIndex((i) => !byItem.get(i.id)?.review);
  const defaultIds = new Set(items.slice(Math.max(0, firstOpen), Math.max(0, firstOpen) + 7).map((i) => i.id));

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={active} />
      {!ai.connected && <Alert variant="warning">{ai.message}</Alert>}
      {ai.provider === "mock" && <Alert>{ai.message}</Alert>}
      {!img.connected && <Alert variant="warning">{img.message} Layouts will be rendered on approved brand photos or a plain brand-colour background.</Alert>}

      {batchJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Batches</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {batchJobs.map((j) => (
              <JobCard key={j.id} job={j} brandId={brand.id} actualCostUsd={costs.get(j.id)} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Produce a batch</CardTitle>
          <CardDescription>
            Pick the days to produce (one week is selected). The team writes the master post, all platform variants
            {brand.languages.length > 1 ? " in both languages" : ""}, visuals and storyboards, then the Creative Director checks each post. You see the estimated cost and confirm before anything runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormAction action={prepareBatchAction.bind(null, brand.id, plan.id)} label="Estimate cost">
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((i) => {
                const post = byItem.get(i.id);
                return (
                  <label key={i.id} className="flex items-start gap-2 rounded border p-2 text-sm">
                    <input type="checkbox" name="items" value={i.id} defaultChecked={defaultIds.has(i.id)} className="mt-1" />
                    <span className="flex flex-col">
                      <span className="flex items-center gap-2">
                        <b>{i.date}</b> <span className="text-muted-foreground">{i.format.replace("_", " ")}</span>
                        {post && <Badge variant={post.review ? "success" : "warning"}>{post.review ? post.status : "partial"}</Badge>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {i.pillar} — {i.angle}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </FormAction>
        </CardContent>
      </Card>
    </div>
  );
}
