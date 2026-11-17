import { inArray } from "drizzle-orm";
import { bulkStatusAction, deleteAssetAction, photoApprovalAction, saveEntryAction, setEntryStatusAction, uploadAssetAction, uploadDocumentsAction } from "@/app/actions/brain";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { EntryForm } from "@/components/brain/entry-form";
import { UploadForm } from "@/components/upload-form";
import { Alert, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { aiStatus } from "@/lib/ai/provider";
import { SECTION_FIELDS } from "@/lib/brand-brain/fields";
import { SECTION_LABELS, SECTIONS, entryText, type Section } from "@/lib/brand-brain/sections";
import { brainIntegrity, entryVersions, listDocuments, listEntries } from "@/lib/brand-brain/service";
import { brandFiles } from "@/lib/brand-brain/uploads";
import { loadBrand } from "@/lib/brands/load";
import { jobs } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const SINGLE: Section[] = ["company", "voice", "visual"];

export default async function BrainPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const { scope, brand } = await loadBrand(brandId);
  const [entries, integrity, docs, files, running] = await Promise.all([
    listEntries(scope),
    brainIntegrity(scope),
    listDocuments(scope),
    brandFiles(scope),
    scope.select(jobs, inArray(jobs.status, ["queued", "running"])),
  ]);
  const ingesting = running.filter((j) => j.type === "ingest_document");
  const docName = new Map(docs.map((d) => [d.id, d.fileName]));
  const proposals = entries.filter((e) => e.status === "proposed");
  const ai = aiStatus();
  const base = `/api/brands/${brand.id}`;

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={ingesting.length > 0} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Brand Brain status{" "}
            {integrity.readyForPlanning ? <Badge variant="success">Ready for planning</Badge> : <Badge variant="warning">Not ready for planning</Badge>}
          </CardTitle>
          <CardDescription>Every AI step reads only the approved entries of this brand.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {integrity.missing.length > 0 && (
            <div>
              <div className="font-medium">Missing before planning:</div>
              <ul className="ml-5 list-disc">
                {integrity.missing.map((m) => (
                  <li key={m.key}>
                    {m.label} ({m.have}/{m.need} approved)
                  </li>
                ))}
              </ul>
            </div>
          )}
          {integrity.conflicts.length > 0 && (
            <Alert variant="warning">
              <div className="font-medium">Conflicting entries — resolve before planning:</div>
              <ul className="ml-5 list-disc">
                {integrity.conflicts.map((c, i) => (
                  <li key={i}>{c.message}</li>
                ))}
              </ul>
            </Alert>
          )}
          {integrity.pendingProposals > 0 && <div>{integrity.pendingProposals} AI proposal(s) waiting for your review below.</div>}
          <div>
            <Button asChild variant="outline" size="sm">
              <a href={`${base}/brain.md`}>Export approved Brand Brain as Markdown</a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>PDF, DOCX, PPTX, XLSX, CSV, TXT, MD or images. The AI proposes entries with the source file and page; nothing is approved until you accept it.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!ai.connected && <Alert variant="warning">{ai.message} Uploads are stored, but no proposals can be made until it is connected.</Alert>}
          {ai.provider === "mock" && <Alert variant="info">{ai.message}</Alert>}
          <UploadForm action={uploadDocumentsAction.bind(null, brand.id)} accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp" label="Upload documents" />
          {docs.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1">File</th>
                  <th>Status</th>
                  <th>Pages</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className="py-1.5">
                      <a className="underline-offset-2 hover:underline" href={`${base}/documents/${d.id}`}>
                        {d.fileName}
                      </a>
                    </td>
                    <td>
                      <Badge variant={d.status === "failed" ? "destructive" : d.status === "proposed" ? "success" : "secondary"}>{d.status}</Badge>
                      {d.error && <div className="text-xs text-destructive">{d.error}</div>}
                    </td>
                    <td>{d.pages?.length ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {proposals.length > 0 && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Proposals to review ({proposals.length})</span>
              <span className="flex gap-2">
                <ActionButton size="sm" action={bulkStatusAction.bind(null, brand.id, proposals.map((p) => p.id), "approved")} confirm={`Approve all ${proposals.length} proposals as written?`}>
                  Approve all
                </ActionButton>
              </span>
            </CardTitle>
            <CardDescription>Check each proposal against its source. Edit to correct it (saving an edit approves it), or reject it.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {proposals.map((e) => (
              <div key={e.id} className="rounded-md border p-3" data-testid="proposal">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{SECTION_LABELS[e.section as Section]}</Badge>
                  <span className="font-medium">{e.title}</span>
                  <span className="text-xs text-muted-foreground">
                    from {e.sourceDocumentId ? (docName.get(e.sourceDocumentId) ?? "deleted file") : e.sourceKind}
                    {e.sourceLocation ? `, ${e.sourceLocation}` : ""}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <ActionButton size="sm" action={setEntryStatusAction.bind(null, brand.id, e.id, "approved")}>
                      Approve
                    </ActionButton>
                    <ActionButton size="sm" variant="outline" action={setEntryStatusAction.bind(null, brand.id, e.id, "rejected")}>
                      Reject
                    </ActionButton>
                  </span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{entryText(e.section as Section, e.data)}</pre>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-primary">Edit and approve</summary>
                  <div className="mt-2">
                    <EntryForm fields={SECTION_FIELDS[e.section as Section]} data={e.data} action={saveEntryAction.bind(null, brand.id, e.section as Section, e.id)} submitLabel="Save and approve" />
                  </div>
                </details>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {SECTIONS.map((section) => {
          const list = entries.filter((e) => e.section === section && e.status === "approved");
          const rejected = entries.filter((e) => e.section === section && e.status === "rejected");
          return (
            <Card key={section} data-testid={`section-${section}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {SECTION_LABELS[section]} <Badge variant={list.length ? "success" : "secondary"}>{list.length}</Badge>
                </CardTitle>
                {section === "pillar" && <CardDescription>Drafted by the Strategist when you plan a month; you can also add your own.</CardDescription>}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {list.map((e) => (
                  <EntryCard key={e.id} brandId={brand.id} entry={e} docName={e.sourceDocumentId ? docName.get(e.sourceDocumentId) : undefined} scopeVersions={entryVersions.bind(null, scope)} />
                ))}
                {(!SINGLE.includes(section) || list.length === 0) && (
                  <details>
                    <summary className="cursor-pointer text-sm text-primary">Add {SINGLE.includes(section) ? "" : "an entry"}</summary>
                    <div className="mt-2">
                      <EntryForm fields={SECTION_FIELDS[section]} action={saveEntryAction.bind(null, brand.id, section, null)} submitLabel="Add" />
                    </div>
                  </details>
                )}
                {rejected.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">{rejected.length} rejected</summary>
                    {rejected.map((e) => (
                      <div key={e.id} className="mt-1 flex items-center gap-2">
                        <span className="line-through">{e.title}</span>
                        <ActionButton size="sm" variant="ghost" action={setEntryStatusAction.bind(null, brand.id, e.id, "approved")}>
                          Restore
                        </ActionButton>
                      </div>
                    ))}
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Visual files</CardTitle>
          <CardDescription>Logo, font files, brand photos and reference images. Only approved brand photos are used as post backgrounds.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {(
            [
              ["logo", "Logo", ".png,.jpg,.jpeg,.webp,.svg"],
              ["font", "Font files", ".ttf,.otf,.woff,.woff2"],
              ["photo", "Brand photos", ".png,.jpg,.jpeg,.webp"],
              ["reference", "Reference images (style only)", ".png,.jpg,.jpeg,.webp"],
            ] as const
          ).map(([kind, label, accept]) => {
            const list = files.filter((f) => f.kind === kind);
            return (
              <div key={kind} className="flex flex-col gap-2">
                <div className="font-medium">
                  {label} <span className="text-muted-foreground">({list.length})</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {list.map((f) => (
                    <div key={f.id} className="flex w-36 flex-col gap-1 text-xs">
                      {kind === "font" ? (
                        <div className="flex h-24 items-center justify-center rounded border bg-muted p-2 text-center">{String(f.meta.family ?? f.fileName)}</div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${base}/assets/${f.id}`} alt={f.fileName} className="h-24 w-36 rounded border bg-muted object-contain" />
                      )}
                      <span className="truncate" title={f.fileName}>
                        {f.fileName}
                      </span>
                      {kind === "photo" && (
                        <ActionButton size="sm" variant={f.meta.approved ? "outline" : "default"} action={photoApprovalAction.bind(null, brand.id, f.id, !f.meta.approved)}>
                          {f.meta.approved ? "Approved ✓ (unapprove)" : "Approve photo"}
                        </ActionButton>
                      )}
                      <ActionButton size="sm" variant="ghost" action={deleteAssetAction.bind(null, brand.id, f.id)} confirm="Delete this file?">
                        Delete
                      </ActionButton>
                    </div>
                  ))}
                </div>
                <UploadForm
                  action={uploadAssetAction.bind(null, brand.id, kind)}
                  accept={accept}
                  label={`Upload ${label.toLowerCase()}`}
                  extra={kind === "font" ? <input name="family" placeholder="Font family name" className="h-9 rounded-md border bg-card px-2 text-sm" /> : undefined}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

async function EntryCard({
  brandId,
  entry,
  docName,
  scopeVersions,
}: {
  brandId: string;
  entry: Awaited<ReturnType<typeof listEntries>>[number];
  docName?: string;
  scopeVersions: (id: string) => ReturnType<typeof entryVersions>;
}) {
  const versions = entry.version > 1 ? await scopeVersions(entry.id) : [];
  const section = entry.section as Section;
  return (
    <div className="rounded-md border p-3" data-testid="entry">
      <div className="flex items-start gap-2">
        <div className="font-medium">{entry.title}</div>
        <span className="ml-auto text-xs text-muted-foreground">
          v{entry.version} · {entry.sourceKind === "document" ? `from ${docName ?? "file"}${entry.sourceLocation ? `, ${entry.sourceLocation}` : ""}` : entry.sourceKind}
        </span>
      </div>
      {section === "visual" && Array.isArray(entry.data.colours) && (
        <div className="mt-2 flex gap-1">
          {(entry.data.colours as { name: string; hex: string }[]).map((c) => (
            <span key={c.hex + c.name} title={`${c.name} ${c.hex}`} className="h-6 w-6 rounded border" style={{ background: c.hex }} />
          ))}
        </div>
      )}
      <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{entryText(section, entry.data)}</pre>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        <details className="w-full">
          <summary className="cursor-pointer text-primary">Edit</summary>
          <div className="mt-2">
            <EntryForm fields={SECTION_FIELDS[section]} data={entry.data} action={saveEntryAction.bind(null, brandId, section, entry.id)} submitLabel="Save new version" />
            <div className="mt-2">
              <ActionButton size="sm" variant="outline" action={setEntryStatusAction.bind(null, brandId, entry.id, "rejected")}>
                Remove (reject)
              </ActionButton>
            </div>
          </div>
        </details>
        {versions.length > 0 && (
          <details className="w-full text-xs">
            <summary className="cursor-pointer text-muted-foreground">Version history ({versions.length})</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {versions.map((v) => (
                <li key={v.id} className="rounded bg-muted p-2">
                  <div>
                    v{v.version} · {v.status} · {v.note} · {v.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </div>
                  <pre className="whitespace-pre-wrap">{entryText(section, v.data)}</pre>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
