import Link from "next/link";
import { approveCleanAction } from "@/app/actions/posts";
import { FormAction } from "@/components/form-action";
import { PostStatus } from "@/components/post-status";
import { Button } from "@/components/ui/button";
import { loadBrand } from "@/lib/brands/load";
import { addDays } from "@/lib/plans/service";
import { coverImages, postsInRange } from "@/lib/posts/review";
import { cn } from "@/lib/utils";
import { masterPosts } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon=0

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ brandId: string }>; searchParams: Promise<{ view?: string; date?: string }> }) {
  const { brandId } = await params;
  const sp = await searchParams;
  const { scope, brand } = await loadBrand(brandId);
  const view = sp.view === "week" ? "week" : "month";
  let anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null;
  if (!anchor) {
    const [first] = await scope.db.select().from(masterPosts).where(scope.where(masterPosts)).orderBy(asc(masterPosts.date)).limit(1);
    anchor = first?.date ?? iso(new Date());
  }
  let from: string, to: string, gridStart: string, cells: number;
  if (view === "week") {
    from = addDays(anchor, -weekday(anchor));
    to = addDays(from, 6);
    gridStart = from;
    cells = 7;
  } else {
    from = `${anchor.slice(0, 7)}-01`;
    const d = new Date(`${from}T00:00:00Z`);
    to = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    gridStart = addDays(from, -weekday(from));
    cells = Math.ceil((weekday(from) + Number(to.slice(8))) / 7) * 7;
  }
  const posts = await postsInRange(scope, from, to);
  const covers = await coverImages(scope, posts.map((p) => p.id));
  const prev = view === "week" ? addDays(from, -7) : iso(new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 2, 1)));
  const next = view === "week" ? addDays(from, 7) : addDays(to, 1);
  const base = `/brands/${brand.id}`;
  const counts = posts.reduce<Record<string, number>>((a, p) => ((a[p.status] = (a[p.status] ?? 0) + 1), a), {});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`?view=${view}&date=${prev}`}>←</Link>
        </Button>
        <h2 className="min-w-48 text-center font-semibold">{view === "week" ? `Week of ${from}` : new Date(`${from}T00:00:00Z`).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
        <Button asChild variant="outline" size="sm">
          <Link href={`?view=${view}&date=${next}`}>→</Link>
        </Button>
        <div className="ml-2 flex gap-1">
          <Button asChild size="sm" variant={view === "month" ? "default" : "ghost"}>
            <Link href={`?view=month&date=${anchor}`}>Month</Link>
          </Button>
          <Button asChild size="sm" variant={view === "week" ? "default" : "ghost"}>
            <Link href={`?view=week&date=${anchor}`}>Week</Link>
          </Button>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {Object.entries(counts)
            .map(([k, v]) => `${v} ${k}`)
            .join(" · ") || "No posts in this range"}
        </span>
      </div>
      {posts.some((p) => p.status === "rendered" || p.status === "draft") && (
        <div className="max-w-xl">
          <FormAction action={approveCleanAction.bind(null, brand.id, from, to)} label="Approve all ready posts without flagged claims" variant="outline" confirm="Approve every rendered post in this range that has no flagged claims?" />
        </div>
      )}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
        {DAY_NAMES.map((d) => (
          <div key={d} className="bg-muted px-2 py-1 font-medium">
            {d}
          </div>
        ))}
        {Array.from({ length: cells }, (_, i) => {
          const date = addDays(gridStart, i);
          const inRange = date >= from && date <= to;
          const dayPosts = posts.filter((p) => p.date === date);
          return (
            <div key={date} className={cn("flex flex-col gap-1 bg-card p-1.5", view === "week" ? "min-h-72" : "min-h-32", !inRange && "opacity-40")} data-testid="calendar-day">
              <div className="text-muted-foreground">{Number(date.slice(8))}</div>
              {dayPosts.map((p) => {
                const cover = covers.get(p.id)?.get(`instagram/${brand.languages[0]}`) ?? [...(covers.get(p.id)?.values() ?? [])][0];
                return (
                  <Link key={p.id} href={`${base}/posts/${p.id}`} className="flex flex-col gap-1 rounded border p-1 hover:border-primary" data-testid="calendar-post">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/brands/${brand.id}/assets/${cover}`} alt="" className={cn("w-full rounded object-cover", view === "week" ? "aspect-[4/5]" : "aspect-square")} loading="lazy" />
                    ) : (
                      <div className={cn("flex w-full items-center justify-center rounded bg-muted p-1 text-center text-[10px]", view === "week" ? "aspect-[4/5]" : "aspect-square")}>
                        {p.format === "short_video" ? "🎬 Storyboard" : "No image yet"}
                      </div>
                    )}
                    <PostStatus status={p.status} flagged={p.review?.flaggedClaims.length} />
                    <span className="line-clamp-2">{p.pillar}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
