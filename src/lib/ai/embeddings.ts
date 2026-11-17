import { createHash } from "node:crypto";
import { EMBEDDING_DIM } from "../db/schema";

/**
 * Local embedding provider: signed feature hashing of words and word pairs into EMBEDDING_DIM dimensions,
 * L2-normalised, stored in pgvector. It needs no API key and keeps brand text on the server. It is a
 * lexical retriever, good at matching product names and claim wording; a semantic provider (e.g. Voyage)
 * can replace it behind the same function later (see docs/DECISIONS.md).
 */
export function embed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9#%]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  const feats = [...words, ...words.slice(1).map((w, i) => `${words[i]}_${w}`)];
  for (const f of feats) {
    const h = createHash("md5").update(f).digest();
    const idx = h.readUInt32LE(0) % EMBEDDING_DIM;
    v[idx] += h[4] & 1 ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

const STOP = new Set(
  "the a an and or of to in on for with is are be this that it as at by from our your we you they their its was were has have had not but yang dan di ke dari untuk dengan ini itu atau pada adalah kami anda".split(" "),
);
