import { asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { BrandScope } from "../brands/scope";
import { brandBrainEntries, brandBrainEntryVersions, documents } from "../db/schema";
import { embed } from "../ai/embeddings";
import { entryText, entryTitle, REQUIRED_FOR_PLANNING, SECTION_LABELS, SECTIONS, validateSectionData, type Section } from "./sections";

export type Entry = typeof brandBrainEntries.$inferSelect;
export type EntryStatus = "proposed" | "approved" | "rejected";

export class ValidationError extends Error {}

function check(section: Section, data: unknown) {
  if (!SECTIONS.includes(section)) throw new ValidationError(`Unknown section ${section}`);
  const parsed = validateSectionData(section, data);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || section}: ${i.message}`).join("; "));
  return parsed.data as Record<string, unknown>;
}

async function snapshot(scope: BrandScope, e: Entry, note: string) {
  await scope.insert(brandBrainEntryVersions, { entryId: e.id, version: e.version, title: e.title, data: e.data, status: e.status, note });
}

/**
 * Creates an entry. Entries typed by the operator are approved right away (the operator is the source);
 * entries proposed by AI (from documents or the Strategist) start as "proposed".
 */
export async function createEntry(
  scope: BrandScope,
  input: { section: Section; data: unknown; status?: EntryStatus; sourceKind?: "manual" | "document" | "strategist"; sourceDocumentId?: string | null; sourceLocation?: string | null },
) {
  const data = check(input.section, input.data);
  const title = entryTitle(input.section, data);
  const [e] = await scope.insert(brandBrainEntries, {
    section: input.section,
    title,
    data,
    status: input.status ?? (input.sourceKind && input.sourceKind !== "manual" ? "proposed" : "approved"),
    sourceKind: input.sourceKind ?? "manual",
    sourceDocumentId: input.sourceDocumentId ?? null,
    sourceLocation: input.sourceLocation ?? null,
    embedding: embed(`${title}\n${entryText(input.section, data)}`),
  });
  await snapshot(scope, e, input.sourceKind === "manual" || !input.sourceKind ? "created by operator" : `proposed from ${input.sourceKind}`);
  return e;
}

/** Edits an entry: new version, version history kept. Editing a proposal counts as the operator accepting it. */
export async function updateEntry(scope: BrandScope, id: string, data: unknown, opts: { approve?: boolean } = {}) {
  const current = await scope.get(brandBrainEntries, id);
  const section = current.section as Section;
  const clean = check(section, data);
  const title = entryTitle(section, clean);
  const [e] = await scope.update(
    brandBrainEntries,
    {
      data: clean,
      title,
      version: current.version + 1,
      status: opts.approve === false ? current.status : "approved",
      embedding: embed(`${title}\n${entryText(section, clean)}`),
      updatedAt: new Date(),
    },
    eq(brandBrainEntries.id, id),
  );
  await snapshot(scope, e, "edited by operator");
  return e;
}

export async function setEntryStatus(scope: BrandScope, id: string, status: EntryStatus) {
  const current = await scope.get(brandBrainEntries, id);
  if (current.status === status) return current;
  const [e] = await scope.update(brandBrainEntries, { status, version: current.version + 1, updatedAt: new Date() }, eq(brandBrainEntries.id, id));
  await snapshot(scope, e, `status → ${status}`);
  return e;
}

export async function bulkSetStatus(scope: BrandScope, ids: string[], status: EntryStatus) {
  for (const id of ids) await setEntryStatus(scope, id, status);
}

export async function listEntries(scope: BrandScope, filter: { status?: EntryStatus; section?: Section } = {}) {
  return scope.db
    .select()
    .from(brandBrainEntries)
    .where(
      scope.where(
        brandBrainEntries,
        filter.status ? eq(brandBrainEntries.status, filter.status) : undefined,
        filter.section ? eq(brandBrainEntries.section, filter.section) : undefined,
      ),
    )
    .orderBy(asc(brandBrainEntries.section), asc(brandBrainEntries.createdAt));
}

export async function entryVersions(scope: BrandScope, entryId: string) {
  return scope.db
    .select()
    .from(brandBrainEntryVersions)
    .where(scope.where(brandBrainEntryVersions, eq(brandBrainEntryVersions.entryId, entryId)))
    .orderBy(desc(brandBrainEntryVersions.version));
}

export type Integrity = {
  missing: { key: string; label: string; have: number; need: number }[];
  conflicts: { kind: string; message: string; entryIds: string[] }[];
  pendingProposals: number;
  readyForPlanning: boolean;
};

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Which sections are missing, which entries conflict, and whether planning may start. */
export async function brainIntegrity(scope: BrandScope): Promise<Integrity> {
  const all = await listEntries(scope);
  const approved = all.filter((e) => e.status === "approved");
  const live = all.filter((e) => e.status !== "rejected");
  const missing = REQUIRED_FOR_PLANNING.map((r) => {
    const have = approved.filter((e) => r.sections.includes(e.section as Section)).length;
    return { key: r.key, label: r.label, have, need: r.min ?? 1 };
  }).filter((m) => m.have < m.need);

  const conflicts: Integrity["conflicts"] = [];
  // Same section + same title but different content.
  const groups = new Map<string, Entry[]>();
  for (const e of live) {
    if (e.section === "voice" || e.section === "visual" || e.section === "company") continue;
    const k = `${e.section}:${norm(e.title)}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  for (const [, list] of groups) {
    const distinct = new Set(list.map((e) => JSON.stringify(e.data)));
    if (list.length > 1 && distinct.size > 1)
      conflicts.push({ kind: "duplicate", message: `${SECTION_LABELS[list[0].section as Section]}: "${list[0].title}" has ${list.length} different versions`, entryIds: list.map((e) => e.id) });
  }
  // Single-entry sections with more than one approved entry.
  for (const section of ["company", "voice", "visual"] as const) {
    const list = approved.filter((e) => e.section === section);
    if (list.length > 1) conflicts.push({ kind: "multiple", message: `${SECTION_LABELS[section]} has ${list.length} approved entries; keep one`, entryIds: list.map((e) => e.id) });
  }
  // Different founding years anywhere in the Brand Brain.
  const years = new Map<string, string[]>();
  for (const e of live) {
    const text = `${e.title} ${entryText(e.section as Section, e.data)}`;
    for (const m of text.matchAll(/(?:founded|established|since|berdiri|didirikan|sejak)\D{0,20}((?:19|20)\d{2})/gi)) {
      years.set(m[1], [...(years.get(m[1]) ?? []), e.id]);
    }
  }
  if (years.size > 1)
    conflicts.push({ kind: "founding_year", message: `Different founding years found: ${[...years.keys()].sort().join(", ")}`, entryIds: [...new Set([...years.values()].flat())] });

  const pendingProposals = all.filter((e) => e.status === "proposed").length;
  return { missing, conflicts, pendingProposals, readyForPlanning: missing.length === 0 && conflicts.length === 0 };
}

/** Approved entries ranked by similarity to the query (pgvector cosine distance). */
export async function retrieveFacts(scope: BrandScope, query: string, k = 8, sections?: Section[]) {
  const q = `[${embed(query).join(",")}]`;
  return scope.db
    .select({
      id: brandBrainEntries.id,
      section: brandBrainEntries.section,
      title: brandBrainEntries.title,
      data: brandBrainEntries.data,
      distance: sql<number>`${brandBrainEntries.embedding} <=> ${q}::vector`,
    })
    .from(brandBrainEntries)
    .where(
      scope.where(
        brandBrainEntries,
        eq(brandBrainEntries.status, "approved"),
        isNotNull(brandBrainEntries.embedding),
        sections ? inArray(brandBrainEntries.section, sections) : undefined,
      ),
    )
    .orderBy(sql`${brandBrainEntries.embedding} <=> ${q}::vector`)
    .limit(k);
}

/** The approved Brand Brain as compact text for prompts, each fact tagged with its id so outputs can cite it. */
export async function brainForPrompt(scope: BrandScope, opts: { focus?: string; maxProducts?: number } = {}) {
  const approved = await listEntries(scope, { status: "approved" });
  let products = approved.filter((e) => e.section === "product");
  if (opts.focus && products.length > (opts.maxProducts ?? 12)) {
    const ranked = await retrieveFacts(scope, opts.focus, opts.maxProducts ?? 12, ["product"]);
    const keep = new Set(ranked.map((r) => r.id));
    products = products.filter((p) => keep.has(p.id));
  }
  const parts: string[] = [];
  for (const section of SECTIONS) {
    const list = section === "product" ? products : approved.filter((e) => e.section === section);
    if (!list.length) continue;
    parts.push(`### ${SECTION_LABELS[section]}`);
    for (const e of list) {
      const data = { ...e.data };
      if (section === "product" && !data.pricePublic) delete data.price;
      delete data.pricePublic;
      parts.push(`[fact:${e.id}] ${e.title}\n${entryText(section, data)}`);
    }
  }
  return { text: parts.join("\n\n") || "(Brand Brain is empty)", entries: approved };
}

export async function brainMarkdown(scope: BrandScope, brandName: string) {
  const approved = await listEntries(scope, { status: "approved" });
  const lines = [`# ${brandName} — Brand Brain`, "", `Exported ${new Date().toISOString().slice(0, 10)}. Approved entries only.`, ""];
  for (const section of SECTIONS) {
    const list = approved.filter((e) => e.section === section);
    if (!list.length) continue;
    lines.push(`## ${SECTION_LABELS[section]}`, "");
    for (const e of list) {
      lines.push(`### ${e.title}`, "");
      for (const [k, v] of Object.entries(e.data)) {
        if (v === "" || (Array.isArray(v) && !v.length)) continue;
        if (Array.isArray(v)) lines.push(`- **${k}:**`, ...v.map((x) => `  - ${typeof x === "object" ? Object.values(x as object).join(" ") : x}`));
        else lines.push(`- **${k}:** ${v}`);
      }
      lines.push(`- _version ${e.version}, updated ${e.updatedAt.toISOString().slice(0, 10)}_`, "");
    }
  }
  return lines.join("\n");
}

export async function listDocuments(scope: BrandScope) {
  return scope.db.select().from(documents).where(scope.where(documents)).orderBy(desc(documents.createdAt));
}

