import { cancelJobAction, confirmJobAction, resumeJobAction } from "@/app/actions/jobs";
import type { Job } from "@/lib/jobs/service";
import { ActionButton } from "./action-button";
import { Alert, Badge } from "./ui/badge";

const VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "default"> = {
  completed: "success",
  awaiting_confirmation: "warning",
  failed: "destructive",
  running: "default",
  queued: "secondary",
  cancelled: "secondary",
};

export function JobCard({ job, brandId, actualCostUsd }: { job: Job; brandId: string; actualCostUsd?: number }) {
  const p = job.progress;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-testid="job">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{job.type.replace(/_/g, " ")}</span>
        <Badge variant={VARIANT[job.status] ?? "secondary"}>{job.status.replace(/_/g, " ")}</Badge>
        <span className="text-xs text-muted-foreground">{job.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
        {actualCostUsd !== undefined && actualCostUsd > 0 && <span className="text-xs text-muted-foreground">actual cost ${actualCostUsd.toFixed(2)}</span>}
      </div>
      {job.estimate && (
        <div className="rounded bg-muted p-2" data-testid="estimate">
          <div>
            Estimate: <b>{job.estimate.aiCalls}</b> AI calls, <b>{job.estimate.imageGenerations}</b> image generations, about <b>${job.estimate.estimatedCostUsd.toFixed(2)}</b>
          </div>
          <ul className="ml-4 list-disc text-xs text-muted-foreground">
            {job.estimate.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {(job.status === "running" || job.status === "queued") && p.total > 0 && (
        <div>
          <div className="h-2 overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {p.done}/{p.total} · {p.message}
          </div>
        </div>
      )}
      {job.status === "completed" && p.message && !p.message.startsWith("{") && <div className="text-xs text-muted-foreground">{p.message}</div>}
      {job.error && <Alert variant="error" className="whitespace-pre-wrap">{job.error}</Alert>}
      <div className="flex gap-2">
        {job.status === "awaiting_confirmation" && (
          <>
            <ActionButton size="sm" action={confirmJobAction.bind(null, brandId, job.id)}>
              Confirm and start
            </ActionButton>
            <ActionButton size="sm" variant="outline" action={cancelJobAction.bind(null, brandId, job.id)}>
              Cancel
            </ActionButton>
          </>
        )}
        {job.status === "failed" && (
          <>
            <ActionButton size="sm" action={resumeJobAction.bind(null, brandId, job.id)}>
              Resume (finished work is kept)
            </ActionButton>
            <ActionButton size="sm" variant="outline" action={cancelJobAction.bind(null, brandId, job.id)}>
              Cancel
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}
