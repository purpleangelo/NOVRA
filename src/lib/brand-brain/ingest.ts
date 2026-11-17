import { eq } from "drizzle-orm";
import { z } from "zod";
import type { BrandScope } from "../brands/scope";
import { assets, brandBrainEntries, documents, jobs } from "../db/schema";
import { runRole } from "../ai/run";
import { getStorage } from "../storage";
import { chunkPages, DOC_TYPES, extractPages, type Page } from "./extract";
import { createEntry } from "./service";
import { validateSectionData, type Section } from "./sections";

const page = z.number().int();
export const extractorSchema = z.object({
  company: z.array(z.object({ page, name: z.string(), sells: z.string(), markets: z.string(), story: z.string() })),
  products: z.array(z.object({ page, name: z.string(), description: z.string(), specs: z.array(z.string()), price: z.string(), pricePublic: z.boolean() })),
  audience: z.array(z.object({ page, persona: z.string(), description: z.string(), markets: z.string(), languages: z.string() })),
  voice: z.array(z.object({ page, personality: z.string(), doWords: z.array(z.string()), dontWords: z.array(z.string()), sampleCaptions: z.array(z.string()) })),
  visual: z.array(
    z.object({ page, colours: z.array(z.object({ name: z.string(), hex: z.string() })), headingFont: z.string(), bodyFont: z.string(), photoStyle: z.string() }),
  ),
  claims_verified: z.array(z.object({ page, claim: z.string(), source: z.string() })),
  claims_forbidden: z.array(z.object({ page, claim: z.string(), reason: z.string() })),
  platforms: z.array(z.object({ page, platform: z.string(), handle: z.string(), frequency: z.string() })),
});
export type ExtractorOutput = z.infer<typeof extractorSchema>;

const SECTION_OF: Record<keyof ExtractorOutput, Section> = {
  company: "company",
  products: "product",
  audience: "audience",
  voice: "voice",
  visual: "visual",
  claims_verified: "claim_verified",
  claims_forbidden: "claim_forbidden",
  platforms: "platform",
};

export function renderPages(pages: Page[]) {
  return pages.map((p) => `[page ${p.page}]\n${p.text}`).join("\n\n");
}

/**
 * Ingests one uploaded document: extracts text per page, asks the extractor role for proposals and stores each
 * valid proposal as a "proposed" Brand Brain entry with its source file and page. Images become brand photos
 * awaiting approval. Idempotent: proposals already created for this document are not duplicated.
 */
export async function ingestDocument(scope: BrandScope, documentId: string, jobId: string | null, brandName: string) {
  const doc = await scope.get(documents, documentId);
  const ext = doc.fileName.slice(doc.fileName.lastIndexOf(".")).toLowerCase();
  const type = DOC_TYPES[ext];
  try {
    if (!type) throw new Error(`Unsupported file type ${ext}`);
    if (type.kind === "image") {
      const [existing] = await scope.select(assets, eq(assets.storageKey, doc.storageKey));
      if (!existing)
        await scope.insert(assets, { kind: "photo", fileName: doc.fileName, storageKey: doc.storageKey, mimeType: doc.mimeType, size: doc.size, origin: "upload", meta: { approved: false, documentId: doc.id } });
      await scope.update(documents, { status: "proposed", pages: [], error: null }, eq(documents.id, doc.id));
      return { proposals: 0, photos: 1 };
    }
    if (doc.status === "proposed") return { proposals: 0, photos: 0 };
    // A previous run may have stopped half-way: drop its still-unreviewed proposals so they are not duplicated.
    await scope.delete(brandBrainEntries, eq(brandBrainEntries.sourceDocumentId, doc.id), eq(brandBrainEntries.status, "proposed"));
    const bytes = await getStorage().get(doc.storageKey);
    const pages = doc.pages?.length ? doc.pages : await extractPages(ext, bytes);
    if (!pages.some((p) => p.text.trim())) throw new Error("No text could be extracted (the file may be scanned images only).");
    await scope.update(documents, { pages, status: "extracted", error: null }, eq(documents.id, doc.id));

    let proposals = 0;
    const chunks = chunkPages(pages);
    for (const [i, chunk] of chunks.entries()) {
      if (jobId) await scope.update(jobs, { progress: { done: i, total: chunks.length, message: `Reading ${doc.fileName}` } }, eq(jobs.id, jobId));
      const text = renderPages(chunk);
      const out = await runRole({
        scope,
        jobId,
        role: "brand_brain_extractor",
        prompt: "brand_brain_extractor",
        vars: { brand_name: brandName, document_name: doc.fileName, document_text: text },
        schema: extractorSchema,
        mock: () => mockExtract(text, doc.fileName),
      });
      for (const [key, section] of Object.entries(SECTION_OF) as [keyof ExtractorOutput, Section][]) {
        for (const item of out[key]) {
          const { page: pg, ...data } = item as { page: number } & Record<string, unknown>;
          if (section === "visual") (data as { colours: { hex: string }[] }).colours = (data.colours as { name: string; hex: string }[]).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex));
          if (!validateSectionData(section, data).success) continue;
          await createEntry(scope, { section, data, sourceKind: "document", sourceDocumentId: doc.id, sourceLocation: `page ${pg}` });
          proposals++;
        }
      }
    }
    await scope.update(documents, { status: "proposed" }, eq(documents.id, doc.id));
    return { proposals, photos: 0 };
  } catch (err) {
    await scope.update(documents, { status: "failed", error: (err as Error).message }, eq(documents.id, doc.id));
    throw err;
  }
}

/**
 * TEST-mode extractor: reads simple "Key: value" lines. Only used with AI_PROVIDER=mock.
 * Recognised keys: Company, Sells, Markets, Story, Product, Description, Spec, Price, Persona, Persona description,
 * Persona markets, Persona languages, Personality, Do words, Don't words, Sample caption, Colour, Heading font,
 * Body font, Photo style, Claim, Source, Do not say, Reason, Platform, Handle, Frequency.
 */
export function mockExtract(text: string, fileName: string): ExtractorOutput {
  const out: ExtractorOutput = { company: [], products: [], audience: [], voice: [], visual: [], claims_verified: [], claims_forbidden: [], platforms: [] };
  let pageNo = 1;
  const kv = (line: string) => {
    const m = /^\s*[-*]?\s*([A-Za-z' ]+):\s*(.+)$/.exec(line);
    return m ? [m[1].trim().toLowerCase(), m[2].trim()] : null;
  };
  for (const line of text.split("\n")) {
    const pm = /^\[page (\d+)\]$/.exec(line.trim());
    if (pm) {
      pageNo = Number(pm[1]);
      continue;
    }
    const pair = kv(line);
    if (!pair) continue;
    const [k, v] = pair;
    const last = <T>(arr: T[]) => arr[arr.length - 1];
    const company = () => (out.company[0] ??= { page: pageNo, name: "", sells: "", markets: "", story: "" });
    const voice = () => (out.voice[0] ??= { page: pageNo, personality: "", doWords: [], dontWords: [], sampleCaptions: [] });
    const visual = () => (out.visual[0] ??= { page: pageNo, colours: [], headingFont: "", bodyFont: "", photoStyle: "" });
    switch (k) {
      case "company":
        company().name = v;
        break;
      case "sells":
        company().sells = v;
        break;
      case "markets":
        company().markets = v;
        break;
      case "story":
        company().story = v;
        break;
      case "product":
        out.products.push({ page: pageNo, name: v, description: "", specs: [], price: "", pricePublic: false });
        break;
      case "description":
        if (last(out.products)) last(out.products).description = v;
        break;
      case "spec":
        if (last(out.products)) last(out.products).specs.push(v);
        break;
      case "price":
        if (last(out.products)) last(out.products).price = v;
        break;
      case "public price":
        if (last(out.products)) Object.assign(last(out.products), { price: v, pricePublic: true });
        break;
      case "persona":
        out.audience.push({ page: pageNo, persona: v, description: "", markets: "", languages: "" });
        break;
      case "persona description":
        if (last(out.audience)) last(out.audience).description = v;
        break;
      case "persona markets":
        if (last(out.audience)) last(out.audience).markets = v;
        break;
      case "persona languages":
        if (last(out.audience)) last(out.audience).languages = v;
        break;
      case "personality":
        voice().personality = v;
        break;
      case "do words":
        voice().doWords = v.split(",").map((x) => x.trim()).filter(Boolean);
        break;
      case "don't words":
      case "dont words":
        voice().dontWords = v.split(",").map((x) => x.trim()).filter(Boolean);
        break;
      case "sample caption":
        voice().sampleCaptions.push(v);
        break;
      case "colour":
      case "color": {
        const m = /^(.*?)\s*(#[0-9a-fA-F]{6})/.exec(v);
        if (m) visual().colours.push({ name: m[1].trim() || m[2], hex: m[2] });
        break;
      }
      case "heading font":
        visual().headingFont = v;
        break;
      case "body font":
        visual().bodyFont = v;
        break;
      case "photo style":
        visual().photoStyle = v;
        break;
      case "claim":
        out.claims_verified.push({ page: pageNo, claim: v, source: `${fileName}, page ${pageNo}` });
        break;
      case "source":
        if (last(out.claims_verified)) last(out.claims_verified).source = v;
        break;
      case "do not say":
        out.claims_forbidden.push({ page: pageNo, claim: v, reason: "" });
        break;
      case "reason":
        if (last(out.claims_forbidden)) last(out.claims_forbidden).reason = v;
        break;
      case "platform":
        out.platforms.push({ page: pageNo, platform: v, handle: "", frequency: "" });
        break;
      case "handle":
        if (last(out.platforms)) last(out.platforms).handle = v;
        break;
      case "frequency":
        if (last(out.platforms)) last(out.platforms).frequency = v;
        break;
    }
  }
  return out;
}
