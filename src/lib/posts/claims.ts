/**
 * Rule-based claim guard that runs on every post in addition to the Creative Director. It finds sentences with
 * factual-sounding claims (numbers, percentages, superlatives, certifications, health/results words, prices)
 * and flags those whose key terms are not found in the approved Brand Brain text, plus anything that matches a
 * do-not-say claim. Deliberately strict: a false flag costs the operator one look; a missed claim can cost the brand.
 */

const RISKY = [
  /\b\d+(?:[.,]\d+)?\s*(?:%|percent|persen|x\b|kg|g\b|gram|ml|l\b|m\b|km|hours?|jam|days?|hari|years?|tahun|°c)/i,
  /\b(?:19|20)\d{2}\b/,
  /\b(?:best|#1|no\.?\s?1|number one|first|only|leading|top|terbaik|pertama|satu-satunya|nomor satu)\b/i,
  /\b(?:certified|certification|sertifikat|bersertifikat|iso\s?\d+|halal|organic|organik|bpom|sni|fda|award|penghargaan|winner|juara)\b/i,
  /\b(?:guarantee[ds]?|garansi|dijamin|proven|terbukti|clinically|klinis|cures?|menyembuhkan|heals?|treats?|prevents?|mencegah|100%)\b/i,
  /\b(?:rp\.?\s?\d|idr\s?\d|\$\s?\d|usd\s?\d|sgd\s?\d)/i,
  /\b(?:customers?|clients?|pelanggan|klien)\b.*\b\d[\d.,]*\b/i,
];

const STOP = new Set(
  "the a an and or of to in on for with is are be this that it as at by from our your we you they their its was were has have had not but more most very all yang dan di ke dari untuk dengan ini itu atau pada adalah kami anda kita lebih sangat".split(" "),
);

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9%#.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function claimTerms(sentence: string) {
  const s = norm(sentence);
  const terms = new Set<string>();
  for (const m of s.matchAll(/\d+(?:[.,]\d+)*/g)) terms.add(m[0].replace(/[.,]/g, ""));
  for (const re of RISKY.slice(2)) {
    const m = re.exec(sentence);
    if (m) terms.add(norm(m[0]).replace(/[.\s]/g, ""));
  }
  return [...terms].filter(Boolean);
}

export function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type ClaimFlag = { claim: string; reason: string; variant?: string };

/**
 * @param texts  copy to check, keyed by where it appears (e.g. "instagram/en")
 * @param factsText  plain text of all approved Brand Brain entries
 * @param forbidden  do-not-say claims
 */
export function checkClaims(texts: Record<string, string>, factsText: string, forbidden: string[]): ClaimFlag[] {
  const facts = norm(factsText);
  const factsCompact = facts.replace(/[.,\s]/g, "");
  const flags: ClaimFlag[] = [];
  const seen = new Set<string>();
  const forb = forbidden.map((f) => norm(f).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
  for (const [where, text] of Object.entries(texts)) {
    for (const sentence of splitSentences(text.replace(/#\w+/g, ""))) {
      const key = norm(sentence);
      for (const [i, words] of forb.entries()) {
        if (words.length && words.every((w) => key.includes(w))) {
          const id = `forbidden:${i}:${key}`;
          if (!seen.has(id)) {
            seen.add(id);
            flags.push({ claim: sentence, reason: `Matches a do-not-say claim: "${forbidden[i]}"`, variant: where });
          }
        }
      }
      if (!RISKY.some((re) => re.test(sentence))) continue;
      const missing = claimTerms(sentence).filter((t) => !facts.includes(t) && !factsCompact.includes(t));
      if (missing.length && !seen.has(key)) {
        seen.add(key);
        flags.push({ claim: sentence, reason: `Not backed by an approved Brand Brain fact (${missing.slice(0, 3).join(", ")})`, variant: where });
      }
    }
  }
  return flags;
}
