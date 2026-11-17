import Link from "next/link";
import { notFound } from "next/navigation";
import { and, inArray } from "drizzle-orm";
import { z } from "zod";
import { approvePostAction, approveVariantAction, editVariantAction, imageSourceAction, regenerateAction, rejectPostAction } from "@/app/actions/posts";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { FormAction } from "@/components/form-action";
import { PostStatus } from "@/components/post-status";
import { VariantEditor } from "@/components/post/variant-editor";
import { Alert, Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { loadBrand } from "@/lib/brands/load";
import { brandBrainEntries, jobs, masterPosts } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/brands/scope";
import { platformLabel, platformRules, type Platform } from "@/lib/platforms";
import { postVariantsOf } from "@/lib/posts/produce";
import { postEvents, slidesToText, variantHistory } from "@/lib/posts/review";

export const dynamic = "force-dynamic";

const SCORE_LABELS: Record<string, string> = { brandFit: "Brand fit", platformFit: "Platform fit", clarity: "Clarity", hookStrength: "Hook strength", claimSafety: "Claim safety" };

export default async function PostPage({ params }: { params: Promise<{ brandId: string; postId: string }> }) {
  const { brandId, postId } = await params;
  const { scope, brand } = await loadBrand(brandId);
  if (!z.string().uuid().safeParse(postId).success) notFound();
  let master;
  try {
    master = await scope.get(masterPosts, postId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [variants, events, active, facts] = await Promise.all([
    postVariantsOf(scope, master.id),
    postEvents(scope, master.id),
    scope.select(jobs, inArray(jobs.status, ["queued", "running"])),
    master.factIds.length ? scope.select(brandBrainEntries, and(inArray(brandBrainEntries.id, master.factIds))) : Promise.resolve([]),
  ]);
  const histories = new Map(await Promise.all(variants.map(async (v) => [v.id, await variantHistory(scope, v.id)] as const)));
  const busy = active.some((j) => ["render_variants", "regenerate_copy", "regenerate_image", "produce_batch"].includes(j.type));
  const review = master.review;
  const base = `/brands/${brand.id}`;
  const img = (id: string) => `/api/brands/${brand.id}/assets/${id}`;

  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh active={busy} />
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`${base}/calendar?view=week&date=${master.date}`} className="text-sm text-muted-foreground hover:underline">
          ← Calendar
        </Link>
        <h2 className="text-xl font-semibold">
          {master.date} · {master.format.replace("_", " ")} · {master.pillar}
        </h2>
        <PostStatus status={master.status} flagged={review?.flaggedClaims.length} />
        {busy && <Badge variant="secondary">working…</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Master post</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>
              <b>Core message:</b> {master.coreMessage}
            </div>
            <div>
              <b>Hooks:</b>
              <ol className="ml-5 list-decimal">
                {master.hooks.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ol>
            </div>
            <div>
              <b>Key visual:</b> {master.visualConcept}
            </div>
            <div>
              <b>CTA:</b> {master.cta}
            </div>
            <div>
              <b>Relies on:</b> {facts.length ? facts.map((f) => f.title).join(" · ") : "no specific Brand Brain fact"}
            </div>
            {master.rejectReason && <Alert variant="error">Rejected: {master.rejectReason}</Alert>}
            <div className="mt-2 flex flex-wrap items-start gap-4">
              <FormAction action={approvePostAction.bind(null, brand.id, master.id)} label="Approve post (all variants)" />
              <FormAction action={rejectPostAction.bind(null, brand.id, master.id)} label="Reject" variant="outline">
                <Input name="reason" placeholder="Reason for rejecting" required className="w-64" />
              </FormAction>
              {master.format !== "short_video" && (
                <FormAction action={imageSourceAction.bind(null, brand.id, master.id)} label="Change image source" variant="outline">
                  <Select name="source" defaultValue={master.imageSource ?? brand.imageSource}>
                    <option value="generated">Generated image</option>
                    <option value="brand_photo">Approved brand photo</option>
                    <option value="plain">Plain brand colour</option>
                  </Select>
                </FormAction>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Creative Director</CardTitle>
            <CardDescription>Editorial guidance, not a performance prediction.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {!review && <p className="text-muted-foreground">Not reviewed yet.</p>}
            {review &&
              Object.entries(review.scores).map(([k, v]) => (
                <div key={k}>
                  <div className="flex items-center justify-between">
                    <span>{SCORE_LABELS[k] ?? k}</span>
                    <span className="font-mono">{"●".repeat(v) + "○".repeat(5 - v)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{review.reasons[k]}</div>
                </div>
              ))}
            {review && review.flaggedClaims.length > 0 && (
              <Alert variant="error" data-testid="flagged-claims">
                <div className="font-medium">Flagged claims ({review.flaggedClaims.length})</div>
                <ul className="ml-4 list-disc">
                  {review.flaggedClaims.map((f, i) => (
                    <li key={i}>
                      “{f.claim}” — {f.reason}
                      {f.variant ? ` [${f.variant}]` : ""}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {variants.map((v) => {
          const rules = platformRules(v.platform as Platform);
          const history = histories.get(v.id) ?? [];
          const current = history.find((h) => h.version === v.version)?.images ?? [];
          const isBoard = v.format === "video_storyboard";
          return (
            <Card key={v.id} data-testid="variant">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {platformLabel(v.platform)} <Badge variant="outline">{v.language.toUpperCase()}</Badge>
                  <PostStatus status={v.status} />
                  <span className="text-xs font-normal text-muted-foreground">
                    {v.format.replace(/_/g, " ")} {v.width}×{v.height} · v{v.version}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {isBoard && v.storyboard ? (
                  <div className="rounded border border-dashed p-2">
                    <Badge variant="warning">{v.storyboard.label}</Badge>
                    <div className="mt-1">
                      <b>Hook:</b> {v.storyboard.hook}
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-primary">Script and {v.storyboard.shots.length} shots</summary>
                      <ul className="mt-1 text-xs">
                        {v.storyboard.script.map((s, i) => (
                          <li key={i}>
                            [{s.start}–{s.end}s] {s.line}
                          </li>
                        ))}
                      </ul>
                      <table className="mt-2 w-full text-xs">
                        <tbody>
                          {v.storyboard.shots.map((s) => (
                            <tr key={s.shot} className="border-t align-top">
                              <td className="pr-1 font-medium">{s.shot}</td>
                              <td className="py-1">
                                <div>{s.action}</div>
                                <div className="text-muted-foreground">
                                  {s.camera} · {s.duration}s{s.onScreenText ? ` · text: “${s.onScreenText}”` : ""}
                                </div>
                                <div className="mt-1 rounded bg-muted p-1 font-mono">Veo: {s.veoPrompt}</div>
                                <div className="mt-1 rounded bg-muted p-1 font-mono">Kling: {s.klingPrompt}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </div>
                ) : current.length ? (
                  <div className={current.length > 1 ? "flex snap-x gap-2 overflow-x-auto" : ""}>
                    {current.map((a) => (
                      <a key={a.id} href={img(a.id)} target="_blank" className="shrink-0 snap-start">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img(a.id)} alt={a.fileName} className={current.length > 1 ? "h-64 rounded border" : "w-full rounded border"} />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="flex aspect-[4/5] items-center justify-center rounded bg-muted text-xs text-muted-foreground">{v.renderError ?? "Rendering…"}</div>
                )}
                {v.renderError && current.length > 0 && <div className="text-xs text-muted-foreground">ⓘ {v.renderError}</div>}
                {v.copy.title && (
                  <div>
                    <b>Title:</b> {v.copy.title}
                  </div>
                )}
                <div className="whitespace-pre-wrap rounded bg-muted p-2">{v.copy.caption}</div>
                <div className="text-xs text-primary">{v.copy.hashtags.join(" ")}</div>
                <div className="text-xs text-muted-foreground">
                  {v.copy.caption.length} characters · {v.copy.hashtags.length} hashtags · CTA: {v.copy.cta}
                </div>
                <div className="flex gap-2">
                  {v.status !== "approved" && (
                    <ActionButton size="sm" action={approveVariantAction.bind(null, brand.id, v.id)}>
                      Approve variant
                    </ActionButton>
                  )}
                </div>
                <VariantEditor
                  editAction={editVariantAction.bind(null, brand.id, v.id)}
                  regenAction={regenerateAction.bind(null, brand.id, v.id)}
                  copy={v.copy}
                  slidesText={v.copy.slides ? slidesToText(v.copy.slides) : undefined}
                  visual={v.visual}
                  hasTitle={!!rules.title}
                  isStoryboard={isBoard}
                  maxChars={rules.caption.maxChars}
                  hashtagRange={[rules.hashtags.min, rules.hashtags.max]}
                />
                {history.length > 1 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Versions ({history.length})</summary>
                    <ul className="mt-1 flex flex-col gap-2">
                      {history.map((h) => (
                        <li key={h.id} className="rounded bg-muted p-2">
                          <div>
                            v{h.version} · {h.reason.replace("_", " ")}
                            {h.instruction ? ` · “${h.instruction}”` : ""} · {h.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                          </div>
                          <div className="mt-1 line-clamp-3 whitespace-pre-wrap">{h.copy.caption}</div>
                          <div className="mt-1 flex gap-1">
                            {h.images.slice(0, 4).map((a) => (
                              <a key={a.id} href={img(a.id)} target="_blank">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={img(a.id)} alt="" className="h-16 rounded border" />
                              </a>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Review history</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            {events.map((e) => {
              const v = variants.find((x) => x.id === e.variantId);
              return (
                <div key={e.id}>
                  {e.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {e.action.replace("_", " ")}
                  {v ? ` · ${platformLabel(v.platform)}/${v.language}` : ""}
                  {e.reason ? ` · “${e.reason}”` : ""}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

