import { z } from "zod";

const s = (max = 2000) => z.string().trim().max(max);
const list = (max = 40) => z.array(z.string().trim().min(1).max(300)).max(max);

/** Structured fields per Brand Brain section. Each entry's `data` is validated with its section schema. */
export const SECTION_SCHEMAS = {
  company: z.object({
    name: s(200),
    sells: s(),
    markets: s(),
    story: s(4000),
  }),
  product: z.object({
    name: s(200).min(1),
    description: s(),
    specs: list(),
    price: s(100).default(""),
    pricePublic: z.boolean().default(false),
  }),
  audience: z.object({
    persona: s(200).min(1),
    description: s(),
    markets: s(500),
    languages: s(200),
  }),
  voice: z.object({
    personality: s(),
    doWords: list(),
    dontWords: list(),
    sampleCaptions: list(10),
  }),
  visual: z.object({
    colours: z.array(z.object({ name: s(60), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex like #1A2B3C") })).max(12),
    headingFont: s(100),
    bodyFont: s(100),
    photoStyle: s(),
  }),
  pillar: z.object({ name: s(120).min(1), description: s() }),
  claim_verified: z.object({ claim: s(500).min(1), source: s(500).min(1, "A verified claim needs a source") }),
  claim_forbidden: z.object({ claim: s(500).min(1), reason: s(500) }),
  platform: z.object({ platform: s(40).min(1), handle: s(120), frequency: s(120) }),
} as const;

export type Section = keyof typeof SECTION_SCHEMAS;
export const SECTIONS = Object.keys(SECTION_SCHEMAS) as Section[];
export type SectionData<S extends Section> = z.infer<(typeof SECTION_SCHEMAS)[S]>;

export const SECTION_LABELS: Record<Section, string> = {
  company: "Company basics",
  product: "Products",
  audience: "Audience personas",
  voice: "Voice",
  visual: "Visual identity",
  pillar: "Content pillars",
  claim_verified: "Verified claims",
  claim_forbidden: "Do-not-say claims",
  platform: "Platforms",
};

/** Sections that must have at least one approved entry before planning. */
export const REQUIRED_FOR_PLANNING: { key: string; label: string; sections: Section[]; min?: number }[] = [
  { key: "company", label: "Company basics", sections: ["company"] },
  { key: "product", label: "At least one product", sections: ["product"] },
  { key: "audience", label: "At least 2 audience personas", sections: ["audience"], min: 2 },
  { key: "voice", label: "Voice", sections: ["voice"] },
  { key: "visual", label: "Visual identity (colours and fonts)", sections: ["visual"] },
  { key: "claims", label: "Claims (verified or do-not-say)", sections: ["claim_verified", "claim_forbidden"] },
];

export function validateSectionData(section: Section, data: unknown) {
  return SECTION_SCHEMAS[section].safeParse(data);
}

/** Title shown in lists, derived from the data. */
export function entryTitle(section: Section, data: Record<string, unknown>): string {
  const d = data as Record<string, string>;
  switch (section) {
    case "company":
      return d.name || "Company";
    case "product":
      return d.name;
    case "audience":
      return d.persona;
    case "voice":
      return "Voice";
    case "visual":
      return "Visual identity";
    case "pillar":
      return d.name;
    case "claim_verified":
    case "claim_forbidden":
      return d.claim.slice(0, 120);
    case "platform":
      return d.platform;
  }
}

/** Plain-text form of an entry, used for embeddings, prompts and Markdown export. */
export function entryText(section: Section, data: Record<string, unknown>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: ${v.map((x) => (typeof x === "object" ? Object.values(x as object).join(" ") : x)).join("; ")}`;
      return `${k}: ${v}`;
    })
    .join("\n");
}
