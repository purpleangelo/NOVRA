import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/lib/db";
import { brandScope } from "@/lib/brands/scope";
import { aiRuns, brandBrainEntries, documents, jobs } from "@/lib/db/schema";
import {
  brainForPrompt,
  brainIntegrity,
  brainMarkdown,
  createEntry,
  entryVersions,
  listEntries,
  retrieveFacts,
  setEntryStatus,
  updateEntry,
  ValidationError,
} from "@/lib/brand-brain/service";
import { chunkPages, extractPages, UploadError, validateUpload } from "@/lib/brand-brain/extract";
import { uploadAsset, uploadDocument, brandFiles } from "@/lib/brand-brain/uploads";
import { registerAllHandlers } from "@/lib/jobs/handlers";
import { runJob } from "@/lib/jobs/run";
import { MockProvider } from "@/lib/ai/provider";
import { db, makeBrand, truncateAll } from "./helpers";
import { makeDocx, makePdf, makePptx, makeXlsx, PNG_1PX } from "./fixtures";

process.env.NOVRA_INLINE_JOBS = "1";
beforeAll(() => registerAllHandlers());
beforeEach(truncateAll);
afterEach(() => {
  MockProvider.failNext = 0;
});
afterAll(closeDb);

const BRAIN_DOC = `Company: Kopi TEST
Sells: Single-origin coffee beans
Markets: Indonesia, Singapore
Story: Founded in 2015 by two TEST baristas.
Product: Gayo Arabica 250g
Description: Washed arabica from Aceh
Spec: Altitude 1,400 m
Spec: Roast: medium
Price: Rp 120.000
Persona: Urban coffee lover
Persona description: 25-35, works in Jakarta
Persona: Home brewer
Personality: Warm, precise, a bit playful
Do words: crafted, origin, fresh
Don't words: cheap, best in the world
Sample caption: Morning starts at the farm.
Colour: Coffee brown #4B2E1E
Colour: Cream #F3E9DC
Heading font: Playfair Display
Body font: Inter
Claim: Roasted within 48 hours of shipping
Source: Roastery SOP v2, page 1
Do not say: Cures fatigue
Reason: Health claim, not allowed`;

describe("document validation and extraction", () => {
  it("rejects unsupported, empty, oversized and disguised files", () => {
    expect(() => validateUpload("x.exe", Buffer.from("MZ"))).toThrow(UploadError);
    expect(() => validateUpload("x.txt", Buffer.alloc(0))).toThrow(/empty/);
    expect(() => validateUpload("fake.pdf", Buffer.from("hello"))).toThrow(/does not look like/);
    expect(() => validateUpload("fake.png", Buffer.from("hello"))).toThrow(/does not look like/);
    expect(() => validateUpload("big.txt", Buffer.alloc(26 * 1024 * 1024, 65))).toThrow(/25 MB/);
    expect(validateUpload("ok.md", Buffer.from("# hi")).kind).toBe("text");
  });

  it("extracts text from PDF (per page), DOCX, PPTX (per slide), XLSX, CSV", async () => {
    const pdf = await extractPages(".pdf", await makePdf(["Product: Alpha", "Product: Beta"]));
    expect(pdf.map((p) => p.page)).toEqual([1, 2]);
    expect(pdf[1].text).toContain("Beta");
    const docx = await extractPages(".docx", await makeDocx(["Company: Kopi TEST", "Sells: beans"]));
    expect(docx[0].text).toContain("Sells: beans");
    const pptx = await extractPages(".pptx", await makePptx([["Slide one"], ["Claim: Organic", "Source: cert 123"]]));
    expect(pptx).toHaveLength(2);
    expect(pptx[1]).toEqual({ page: 2, text: "Claim: Organic\nSource: cert 123" });
    const xlsx = await extractPages(".xlsx", await makeXlsx([["Product", "Price"], ["Gayo", "120000"]]));
    expect(xlsx[0].text).toContain("Gayo | 120000");
    const csv = await extractPages(".csv", Buffer.from("﻿a,b\n1,2"));
    expect(csv[0].text).toBe("a,b\n1,2");
  });

  it("splits long pages into chunks without dropping text", () => {
    const chunks = chunkPages([{ page: 1, text: "x".repeat(25) }, { page: 2, text: "y".repeat(5) }], 10);
    const all = chunks.flat();
    expect(all.map((p) => p.text).join("")).toBe("x".repeat(25) + "y".repeat(5));
    expect(all.every((p) => p.text.length <= 10)).toBe(true);
  });
});

describe("Brand Brain entries", () => {
  it("validates section data, versions every change and keeps history", async () => {
    const brand = await makeBrand();
    const { scope } = await brandScope(db(), brand.id);
    await expect(createEntry(scope, { section: "claim_verified", data: { claim: "ISO 9001", source: "" } })).rejects.toBeInstanceOf(ValidationError);
    await expect(createEntry(scope, { section: "visual", data: { colours: [{ name: "x", hex: "red" }], headingFont: "", bodyFont: "", photoStyle: "" } })).rejects.toThrow(/hex/);
    const e = await createEntry(scope, { section: "product", data: { name: "Gayo", description: "", specs: ["250g"] } });
    expect(e.status).toBe("approved"); // typed by operator
    const p = await createEntry(scope, { section: "product", data: { name: "Toraja", description: "", specs: [] }, sourceKind: "document" });
    expect(p.status).toBe("proposed");
    const edited = await updateEntry(scope, p.id, { name: "Toraja Sapan", description: "", specs: ["200g"] });
    expect(edited.status).toBe("approved");
    expect(edited.version).toBe(2);
    await setEntryStatus(scope, e.id, "rejected");
    const versions = await entryVersions(scope, p.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1].title).toBe("Toraja");
  });

  it("reports missing sections and conflicts before planning", async () => {
    const brand = await makeBrand();
    const { scope } = await brandScope(db(), brand.id);
    let integ = await brainIntegrity(scope);
    expect(integ.readyForPlanning).toBe(false);
    expect(integ.missing.map((m) => m.key)).toEqual(["company", "product", "audience", "voice", "visual", "claims"]);
    await createEntry(scope, { section: "company", data: { name: "Kopi", sells: "beans", markets: "ID", story: "Founded in 2015." } });
    await createEntry(scope, { section: "product", data: { name: "Gayo", description: "Established 2018 line", specs: [] } });
    await createEntry(scope, { section: "product", data: { name: "Gayo", description: "Different", specs: ["1kg"] } });
    integ = await brainIntegrity(scope);
    expect(integ.missing.map((m) => m.key)).not.toContain("company");
    expect(integ.conflicts.map((c) => c.kind).sort()).toEqual(["duplicate", "founding_year"]);
  });

  it("retrieves the most relevant approved facts with pgvector and never another brand's", async () => {
    const a = await makeBrand();
    const b = await makeBrand();
    const { scope: sa } = await brandScope(db(), a.id);
    const { scope: sb } = await brandScope(db(), b.id);
    await createEntry(sa, { section: "product", data: { name: "Gayo Arabica", description: "washed coffee from Aceh highlands", specs: [] } });
    await createEntry(sa, { section: "product", data: { name: "Ceramic dripper", description: "pour over brewing tool", specs: [] } });
    await createEntry(sa, { section: "product", data: { name: "Unapproved", description: "coffee Aceh", specs: [] }, sourceKind: "document" });
    await createEntry(sb, { section: "product", data: { name: "Brand B Aceh coffee", description: "Aceh coffee arabica", specs: [] } });
    const hits = await retrieveFacts(sa, "arabica coffee from Aceh", 5);
    expect(hits[0].title).toBe("Gayo Arabica");
    expect(hits.map((h) => h.title)).not.toContain("Unapproved");
    expect(hits.map((h) => h.title)).not.toContain("Brand B Aceh coffee");
    const prompt = await brainForPrompt(sa);
    expect(prompt.text).toContain("Gayo Arabica");
    expect(prompt.text).not.toContain("Brand B");
  });

  it("hides non-public prices from prompts and exports Markdown", async () => {
    const brand = await makeBrand({ name: "Kopi TEST" });
    const { scope } = await brandScope(db(), brand.id);
    await createEntry(scope, { section: "product", data: { name: "Secret price", description: "", specs: [], price: "Rp 99", pricePublic: false } });
    await createEntry(scope, { section: "product", data: { name: "Public price", description: "", specs: [], price: "Rp 50", pricePublic: true } });
    const p = await brainForPrompt(scope);
    expect(p.text).not.toContain("Rp 99");
    expect(p.text).toContain("Rp 50");
    const md = await brainMarkdown(scope, brand.name);
    expect(md).toContain("# Kopi TEST — Brand Brain");
    expect(md).toContain("## Products");
  });
});

describe("document ingestion job", () => {
  it("turns a DOCX into proposals with source file and page, then approval unlocks planning", async () => {
    const brand = await makeBrand();
    const { scope } = await brandScope(db(), brand.id);
    const { doc, job } = await uploadDocument(scope, "brand-profile.docx", await makeDocx(BRAIN_DOC.split("\n")));
    expect(job.status).toBe("queued");
    await runJob(job.id, brand.id);
    const [j] = await scope.select(jobs, eq(jobs.id, job.id));
    expect(j.status).toBe("completed");
    const proposals = await listEntries(scope, { status: "proposed" });
    expect(proposals.length).toBe(8);
    expect(proposals.every((p) => p.sourceDocumentId === doc.id && p.sourceLocation === "page 1")).toBe(true);
    const sections = new Set(proposals.map((p) => p.section));
    for (const s of ["company", "product", "audience", "voice", "visual", "claim_verified", "claim_forbidden"]) expect(sections).toContain(s);
    expect((await brainIntegrity(scope)).readyForPlanning).toBe(false);
    for (const p of proposals) await setEntryStatus(scope, p.id, "approved");
    expect(await brainIntegrity(scope)).toMatchObject({ readyForPlanning: true, missing: [] });
    // Running the job again does not duplicate proposals.
    await scope.update(jobs, { status: "queued" }, eq(jobs.id, job.id));
    await runJob(job.id, brand.id);
    expect((await listEntries(scope)).length).toBe(proposals.length);
    const runs = await scope.select(aiRuns);
    expect(runs[0]).toMatchObject({ role: "brand_brain_extractor", promptVersion: "brand_brain_extractor@1.0.0", status: "ok" });
  });

  it("PDF proposals carry the right page numbers", async () => {
    const brand = await makeBrand();
    const { scope } = await brandScope(db(), brand.id);
    const { job } = await uploadDocument(scope, "catalogue.pdf", await makePdf(["Intro page", "Product: Toraja Sapan\nSpec: 200g"]));
    await runJob(job.id, brand.id);
    const [prod] = await listEntries(scope, { section: "product" });
    expect(prod).toMatchObject({ title: "Toraja Sapan", sourceLocation: "page 2", status: "proposed" });
  });

  it("an AI API error marks the document and job failed, logs the run, and is retryable", async () => {
    const brand = await makeBrand();
    const { scope } = await brandScope(db(), brand.id);
    const { doc, job } = await uploadDocument(scope, "notes.txt", Buffer.from("Product: Gayo"));
    MockProvider.failNext = 1;
    MockProvider.failWith = "fatal";
    await expect(runJob(job.id, brand.id)).rejects.toThrow(/simulated AI API error/);
    const [d] = await scope.select(documents, eq(documents.id, doc.id));
    expect(d.status).toBe("failed");
    expect(d.error).toMatch(/simulated AI API error/);
    const [j] = await scope.select(jobs, eq(jobs.id, job.id));
    expect(j.status).toBe("failed");
    const runs = await scope.select(aiRuns);
    expect(runs.some((r) => r.status === "error" && /simulated/.test(r.error ?? ""))).toBe(true);
    // Retry works.
    await scope.update(jobs, { status: "queued" }, eq(jobs.id, job.id));
    await runJob(job.id, brand.id);
    expect((await listEntries(scope)).map((e) => e.title)).toEqual(["Gayo"]);
  });

  it("retries retryable AI errors with backoff", async () => {
    const brand = await makeBrand();
    const { scope } = await brandScope(db(), brand.id);
    const { job } = await uploadDocument(scope, "notes.md", Buffer.from("Product: Gayo"));
    MockProvider.failNext = 2;
    MockProvider.failWith = "retryable";
    await runJob(job.id, brand.id);
    const runs = await scope.select(aiRuns);
    expect(runs.map((r) => r.status).sort()).toEqual(["error", "error", "ok"]);
  });

  it("images become brand photos awaiting approval; asset uploads are validated", async () => {
    const brand = await makeBrand();
    const { scope } = await brandScope(db(), brand.id);
    const { job } = await uploadDocument(scope, "shop.png", PNG_1PX);
    await runJob(job.id, brand.id);
    const files = await brandFiles(scope);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ kind: "photo", meta: { approved: false } });
    await expect(uploadAsset(scope, "logo", "logo.svg", Buffer.from('<svg onload="alert(1)"></svg>'))).rejects.toThrow(/scripts/);
    await expect(uploadAsset(scope, "font", "font.exe", Buffer.from("x"))).rejects.toThrow(/not allowed/);
    const logo = await uploadAsset(scope, "logo", "logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'));
    expect(logo.storageKey.startsWith(`brands/${brand.id}/`)).toBe(true);
  });
});

describe("isolation", () => {
  it("brand B never sees brand A's entries, documents or files", async () => {
    const a = await makeBrand();
    const b = await makeBrand();
    const { scope: sa } = await brandScope(db(), a.id);
    const { scope: sb } = await brandScope(db(), b.id);
    const { job } = await uploadDocument(sa, "a.md", Buffer.from(BRAIN_DOC));
    await runJob(job.id, a.id);
    await uploadAsset(sa, "photo", "p.png", PNG_1PX);
    expect(await listEntries(sb)).toHaveLength(0);
    expect(await sb.select(documents)).toHaveLength(0);
    expect(await brandFiles(sb)).toHaveLength(0);
    expect((await sb.select(brandBrainEntries)).length).toBe(0);
    expect((await brainForPrompt(sb)).text).toBe("(Brand Brain is empty)");
  });
});
