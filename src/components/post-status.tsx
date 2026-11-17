import { Badge } from "./ui/badge";

const MAP: Record<string, { label: string; v: "success" | "warning" | "destructive" | "secondary" | "default" | "outline" }> = {
  concept: { label: "concept", v: "secondary" },
  draft: { label: "draft", v: "warning" },
  rendered: { label: "rendered", v: "default" },
  approved: { label: "approved", v: "success" },
  exported: { label: "exported", v: "outline" },
  rejected: { label: "rejected", v: "destructive" },
};

export function PostStatus({ status, flagged }: { status: string; flagged?: number }) {
  const m = MAP[status] ?? { label: status, v: "secondary" as const };
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={m.v}>{m.label}</Badge>
      {flagged ? (
        <Badge variant="destructive" title="Flagged claims">
          ⚑ {flagged}
        </Badge>
      ) : null}
    </span>
  );
}
