import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { addItemAction, approvePlanAction, deleteItemAction, generatePlanAction, moveItemAction, updateItemAction } from "@/app/actions/plans";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { FormAction } from "@/components/form-action";
import { PlanRowForm } from "@/components/plan/plan-row";
import { Alert, Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { aiStatus } from "@/lib/ai/provider";
import { brainIntegrity } from "@/lib/brand-brain/service";
import { loadBrand } from "@/lib/brands/load";
import { jobs } from "@/lib/db/schema";
import { addDays, getPlan, latestPlan, listPlans, planWarnings } from "@/lib/plans/service";

export const dynamic = "force-dynamic";

function nextMonthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export default async function PlanPage({ params, searchParams }: { params: Promise<{ brandId: string }>; searchParams: Promise<{ plan?: string }> }) {
  const { brandId } = await params;
  const { plan: planParam } = await searchParams;
  const { scope, brand } = await loadBrand(brandId);
  const [integrity, plans, running, failed] = await Promise.all([
    brainIntegrity(scope),
    listPlans(scope),
    scope.select(jobs, eq(jobs.type, "generate_plan"), inArray(jobs.status, ["queued", "running"])),
    scope.select(jobs, and(eq(jobs.type, "generate_plan"), eq(jobs.status, "failed"))),
  ]);
  const current = planParam ? plans.find((p) => p.id === planParam) : await latestPlan(scope);
  const data = current ? await getPlan(scope, current.id) : null;
  const ai = aiStatus();
  const lastFailed = failed.sort((a, b) => +b.createdAt - +a.createdAt)[0];
  const base = `/brands/${brand.id}`;

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={running.length > 0} />
      {!integrity.readyForPlanning && (
        <Alert variant="warning">
          Planning is locked until the Brand Brain is complete: {[...integrity.missing.map((m) => m.label), ...integrity.conflicts.map((c) => c.message)].join("; ")}.{" "}
          <Link className="underline" href={`${base}/brain`}>
            Open Brand Brain
          </Link>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Plan a month</CardTitle>
          <CardDescription>
            The Strategist proposes pillars and one row per post. Mix target: {Object.entries(brand.formatMix).map(([k, v]) => `${k.replace("_", " ")} ${v}%`).join(", ")}. Estimated cost: 1 AI call (about $0.15).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!ai.connected && <Alert variant="warning" className="mb-3">{ai.message}</Alert>}
          {running.length > 0 ? (
            <Alert>The Strategist is working… ({running[0].status})</Alert>
          ) : (
            <FormAction action={generatePlanAction.bind(null, brand.id)} label={data ? "Generate a new draft plan" : "Generate plan"} confirm={data?.plan.status === "draft" ? "This replaces the current draft plan. Continue?" : undefined}>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="startDate">Start date</Label>
                  <Input id="startDate" name="startDate" type="date" defaultValue={nextMonthStart()} required />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="postsCount">Posts (20–60)</Label>
                  <Input id="postsCount" name="postsCount" type="number" min={20} max={60} defaultValue={brand.postsPerMonth} />
                </div>
                <div className="flex flex-col gap-1 sm:col-span-3">
                  <Label htmlFor="notes">Notes for the Strategist (optional)</Label>
                  <Textarea id="notes" name="notes" rows={2} placeholder="e.g. launch of a new product on the 15th, Ramadan in March" />
                </div>
              </div>
            </FormAction>
          )}
          {lastFailed && running.length === 0 && (!current || lastFailed.createdAt > current.createdAt) && (
            <Alert variant="error" className="mt-3">
              Last plan generation failed: {lastFailed.error}
            </Alert>
          )}
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Plan from {data.plan.startDate} to {addDays(data.plan.startDate, data.plan.days - 1)}
              <Badge variant={data.plan.status === "approved" ? "success" : data.plan.status === "draft" ? "warning" : "secondary"}>{data.plan.status}</Badge>
              <span className="text-sm font-normal text-muted-foreground">{data.items.length} posts</span>
            </CardTitle>
            <CardDescription>
              Pillars: {data.plan.pillars.map((p) => p.name).join(" · ")}
              {plans.length > 1 && (
                <span className="ml-3">
                  Other plans:{" "}
                  {plans
                    .filter((p) => p.id !== data.plan.id)
                    .slice(0, 5)
                    .map((p) => (
                      <Link key={p.id} href={`?plan=${p.id}`} className="mr-2 underline">
                        {p.startDate} ({p.status})
                      </Link>
                    ))}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.plan.pillars.length > 0 && (
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {data.plan.pillars.map((p) => (
                  <li key={p.name}>
                    <span className="font-medium">{p.name}</span> — <span className="text-muted-foreground">{p.description}</span>
                  </li>
                ))}
              </ul>
            )}
            {planWarnings(data.plan, data.items).map((w) => (
              <Alert key={w} variant="warning">
                {w}
              </Alert>
            ))}
            <div>
              <div className="grid grid-cols-[8.5rem_9rem_8rem_1fr_7.5rem_auto] gap-2 text-xs font-medium text-muted-foreground max-lg:hidden">
                <span>Date</span>
                <span>Pillar</span>
                <span>Format</span>
                <span>Angle</span>
                <span>Goal</span>
                <span />
              </div>
              {data.items.map((item, i) => (
                <PlanRowForm
                  key={`${item.id}-${item.pillar}-${item.format}-${item.angle}-${item.goal}-${item.date}`}
                  values={item}
                  pillars={data.plan.pillars.map((p) => p.name)}
                  action={updateItemAction.bind(null, brand.id, item.id)}
                  submitLabel="Save"
                  locked={data.plan.status !== "draft"}
                >
                  {data.plan.status === "draft" && (
                    <>
                      <ActionButton type="button" size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} action={moveItemAction.bind(null, brand.id, item.id, "up")}>
                        ↑
                      </ActionButton>
                      <ActionButton type="button" size="sm" variant="ghost" aria-label="Move down" disabled={i === data.items.length - 1} action={moveItemAction.bind(null, brand.id, item.id, "down")}>
                        ↓
                      </ActionButton>
                      <ActionButton type="button" size="sm" variant="ghost" aria-label="Delete row" action={deleteItemAction.bind(null, brand.id, item.id)}>
                        ✕
                      </ActionButton>
                    </>
                  )}
                </PlanRowForm>
              ))}
              {data.plan.status === "draft" && (
                <div className="mt-2">
                  <div className="text-sm font-medium">Add a post</div>
                  <PlanRowForm
                    values={{ date: data.items.at(-1)?.date ?? data.plan.startDate, pillar: data.plan.pillars[0]?.name ?? "", format: "single_image", angle: "", goal: "awareness" }}
                    pillars={data.plan.pillars.map((p) => p.name)}
                    action={addItemAction.bind(null, brand.id, data.plan.id)}
                    submitLabel="Add"
                  />
                </div>
              )}
            </div>
            {data.plan.status === "draft" && <FormAction action={approvePlanAction.bind(null, brand.id, data.plan.id)} label="Approve plan" />}
            {data.plan.status === "approved" && (
              <Alert variant="success">
                Approved {data.plan.approvedAt?.toISOString().slice(0, 10)}.{" "}
                <Link href={`${base}/produce`} className="underline">
                  Produce a batch
                </Link>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
