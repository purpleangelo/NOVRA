import type { Section } from "./sections";

export type FieldType = "text" | "textarea" | "list" | "boolean" | "colours";
export type Field = { key: string; label: string; type: FieldType; hint?: string };

/** Form fields per section (client-safe). Lists are one item per line; colours are "Name #RRGGBB" per line. */
export const SECTION_FIELDS: Record<Section, Field[]> = {
  company: [
    { key: "name", label: "Company name", type: "text" },
    { key: "sells", label: "What it sells", type: "textarea" },
    { key: "markets", label: "Markets", type: "text" },
    { key: "story", label: "Short story", type: "textarea" },
  ],
  product: [
    { key: "name", label: "Product name", type: "text" },
    { key: "description", label: "Description", type: "textarea" },
    { key: "specs", label: "Real specs", type: "list", hint: "One spec per line, exactly as documented" },
    { key: "price", label: "Price", type: "text" },
    { key: "pricePublic", label: "Price is public (may appear in posts)", type: "boolean" },
  ],
  audience: [
    { key: "persona", label: "Persona name", type: "text" },
    { key: "description", label: "Who they are", type: "textarea" },
    { key: "markets", label: "Markets", type: "text" },
    { key: "languages", label: "Languages", type: "text" },
  ],
  voice: [
    { key: "personality", label: "Personality", type: "textarea" },
    { key: "doWords", label: "Words to use", type: "list" },
    { key: "dontWords", label: "Words to avoid", type: "list" },
    { key: "sampleCaptions", label: "3 sample captions you like", type: "list", hint: "One caption per line" },
  ],
  visual: [
    { key: "colours", label: "Colour palette", type: "colours", hint: "One per line: Name #RRGGBB (first = primary, second = secondary, third = accent)" },
    { key: "headingFont", label: "Heading font", type: "text", hint: "Google Fonts name or the name of an uploaded font file" },
    { key: "bodyFont", label: "Body font", type: "text" },
    { key: "photoStyle", label: "Photo style notes", type: "textarea" },
  ],
  pillar: [
    { key: "name", label: "Pillar", type: "text" },
    { key: "description", label: "Description", type: "textarea" },
  ],
  claim_verified: [
    { key: "claim", label: "Verified claim", type: "textarea" },
    { key: "source", label: "Source (document, certificate, link)", type: "text" },
  ],
  claim_forbidden: [
    { key: "claim", label: "Do-not-say claim", type: "textarea" },
    { key: "reason", label: "Why", type: "text" },
  ],
  platform: [
    { key: "platform", label: "Platform", type: "text" },
    { key: "handle", label: "Handle", type: "text" },
    { key: "frequency", label: "Posting frequency", type: "text" },
  ],
};

export function formToData(section: Section, form: FormData): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of SECTION_FIELDS[section]) {
    const raw = String(form.get(f.key) ?? "");
    if (f.type === "boolean") data[f.key] = form.get(f.key) === "on";
    else if (f.type === "list") data[f.key] = raw.split("\n").map((x) => x.trim()).filter(Boolean);
    else if (f.type === "colours")
      data[f.key] = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const m = /^(.*?)\s*(#[0-9a-fA-F]{6})\s*$/.exec(l);
          return m ? { name: m[1].trim() || m[2], hex: m[2].toUpperCase() } : { name: l, hex: l };
        });
    else data[f.key] = raw.trim();
  }
  return data;
}

export function dataToFormValue(f: Field, v: unknown): string {
  if (f.type === "list") return Array.isArray(v) ? v.join("\n") : "";
  if (f.type === "colours") return Array.isArray(v) ? (v as { name: string; hex: string }[]).map((c) => `${c.name} ${c.hex}`).join("\n") : "";
  return v === undefined || v === null ? "" : String(v);
}
