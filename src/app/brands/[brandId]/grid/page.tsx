import Link from "next/link";
import { inArray } from "drizzle-orm";
import { PostStatus } from "@/components/post-status";
import { Alert } from "@/components/ui/badge";
import { loadBrand } from "@/lib/brands/load";
import { masterPosts } from "@/lib/db/schema";
import { coverImages } from "@/lib/posts/review";

export const dynamic = "force-dynamic";

/** Instagram grid preview: the next 12 posts as they would appear on the profile (newest top-left). */
export default async function GridPage({ params, searchParams }: { params: Promise<{ brandId: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { brandId } = await params;
  const { lang: langParam } = await searchParams;
  const { scope, brand } = await loadBrand(brandId);
  const lang = langParam && brand.languages.includes(langParam) ? langParam : brand.languages[0];
  const upcoming = await scope.db
    .select()
    .from(masterPosts)
    .where(scope.where(masterPosts, inArray(masterPosts.status, ["draft", "rendered", "approved", "exported"])))
    .orderBy(masterPosts.date)
    .limit(12);
  const posts = [...upcoming].sort((a, b) => b.date.localeCompare(a.date)); // profile shows newest first
  const covers = await coverImages(scope, posts.map((p) => p.id));
  const base = `/brands/${brand.id}`;

  return (
    <div className="flex flex-col gap-4">
      {!brand.platforms.includes("instagram") && <Alert variant="warning">Instagram is not an active platform for this brand.</Alert>}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Next {posts.length} posts, newest first, as on the Instagram profile.</span>
        {brand.languages.length > 1 &&
          brand.languages.map((l) => (
            <Link key={l} href={`?lang=${l}`} className={l === lang ? "font-semibold underline" : "text-muted-foreground"}>
              {l.toUpperCase()}
            </Link>
          ))}
      </div>
      <div className="mx-auto w-full max-w-[640px] rounded-lg border bg-card p-3">
        <div className="mb-3 flex items-center gap-3 border-b pb-3">
          <div className="h-14 w-14 rounded-full bg-muted" />
          <div>
            <div className="font-semibold">{brand.name}</div>
            <div className="text-xs text-muted-foreground">Grid preview</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-0.5" data-testid="ig-grid">
          {posts.map((p) => {
            const cover = covers.get(p.id)?.get(`instagram/${lang}`);
            return (
              <Link key={p.id} href={`${base}/posts/${p.id}`} className="group relative aspect-[4/5] overflow-hidden bg-muted" title={`${p.date} · ${p.pillar}`}>
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/brands/${brand.id}/assets/${cover}`} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted-foreground">
                    <span className="text-2xl">{p.format === "short_video" ? "🎬" : "🖼"}</span>
                    {p.format === "short_video" ? "Reel storyboard (video not rendered)" : "Not rendered yet"}
                  </div>
                )}
                <div className="absolute bottom-1 left-1 opacity-90">
                  <PostStatus status={p.status} />
                </div>
                <div className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{p.date.slice(5)}</div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
