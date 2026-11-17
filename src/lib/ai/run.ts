import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { BrandScope } from "../brands/scope";
import { aiRuns, usageRecords } from "../db/schema";
import { costUsd, getTextProvider, RetryableAiError } from "./provider";

export type AiRole = "strategist" | "copywriter" | "visual_director" | "video_producer" | "creative_director" | "brand_brain_extractor";

type Prompt = { version: string; system: string; user: string };
const cache = new Map<string, Prompt>();

/** Prompt files live in prompts/<name>.md: frontmatter `version`, then `## System` and `## User` sections. */
export function loadPrompt(name: string): Prompt {
  const hit = cache.get(name);
  if (hit && process.env.NODE_ENV === "production") return hit;
  const raw = fs.readFileSync(path.resolve(process.cwd(), "prompts", `${name}.md`), "utf8");
  const version = /^---\s*\n[\s\S]*?version:\s*([^\n]+)\n[\s\S]*?---/m.exec(raw)?.[1]?.trim();
  const system = /## System\s*\n([\s\S]*?)(?=\n## User)/.exec(raw)?.[1]?.trim();
  const user = /## User\s*\n([\s\S]*)$/.exec(raw)?.[1]?.trim();
  if (!version || !system || !user) throw new Error(`Prompt ${name} is malformed (needs version, ## System, ## User).`);
  const p = { version: `${name}@${version}`, system, user };
  cache.set(name, p);
  return p;
}

export function render(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`Prompt variable {{${k}}} missing`);
    return typeof v === "string" ? v : JSON.stringify(v, null, 2);
  });
}

/** Zod → JSON schema accepted by structured outputs: objects closed, unsupported numeric/string limits removed (Zod still enforces them). */
export function toStructuredSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "maxItems", "pattern", "format", "$schema", "default"].includes(k)) continue;
      if (k === "minItems" && typeof v === "number" && v > 1) continue;
      out[k] = strip(v);
    }
    if (out.type === "object") {
      out.additionalProperties = false;
      if (out.properties && !out.required) out.required = Object.keys(out.properties as object);
    }
    return out;
  };
  return strip(json) as Record<string, unknown>;
}

export class AiOutputError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs one AI role: renders its versioned prompt, calls the text provider with a JSON schema, validates the
 * answer with Zod, retries retryable failures with backoff, and logs every attempt in ai_runs + usage_records.
 */
export async function runRole<T>(opts: {
  scope: BrandScope;
  jobId?: string | null;
  role: AiRole;
  prompt: string;
  vars: Record<string, unknown>;
  schema: z.ZodType<T>;
  mock: () => T;
  maxAttempts?: number;
  maxTokens?: number;
}): Promise<T> {
  const provider = getTextProvider();
  const prompt = loadPrompt(opts.prompt);
  const system = render(prompt.system, opts.vars);
  let user = render(prompt.user, opts.vars);
  const jsonSchema = toStructuredSchema(opts.schema);
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    let tokens = { input: 0, output: 0, model: provider.model };
    try {
      const res = await provider.complete({ system, user, jsonSchema, maxTokens: opts.maxTokens, mock: opts.mock });
      tokens = { input: res.inputTokens, output: res.outputTokens, model: res.model };
      let parsed: T;
      try {
        parsed = opts.schema.parse(JSON.parse(res.text));
      } catch (e) {
        const detail = e instanceof z.ZodError ? e.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (e as Error).message;
        user = `${render(prompt.user, opts.vars)}\n\nYour previous answer was invalid (${detail}). Answer again with valid JSON that follows the schema exactly.`;
        throw new RetryableAiError(`Invalid AI output: ${detail}`);
      }
      await logRun(opts, prompt.version, provider.name, tokens, Date.now() - started, "ok", null, attempt, parsed);
      return parsed;
    } catch (err) {
      lastErr = err;
      await logRun(opts, prompt.version, provider.name, tokens, Date.now() - started, "error", (err as Error).message, attempt, null);
      if (!(err instanceof RetryableAiError) || attempt === maxAttempts) break;
      await sleep(process.env.AI_PROVIDER === "mock" ? 10 : 1000 * 4 ** (attempt - 1));
    }
  }
  throw new AiOutputError(`${opts.role} failed: ${(lastErr as Error)?.message ?? lastErr}`);
}

async function logRun(
  opts: { scope: BrandScope; jobId?: string | null; role: AiRole },
  promptVersion: string,
  provider: string,
  tokens: { input: number; output: number; model: string },
  durationMs: number,
  status: "ok" | "error",
  error: string | null,
  attempt: number,
  output: unknown,
) {
  const cost = costUsd(tokens.model, tokens.input, tokens.output);
  await opts.scope.insert(aiRuns, {
    jobId: opts.jobId ?? null,
    role: opts.role,
    promptVersion,
    provider,
    model: tokens.model,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    costUsd: cost.toFixed(6),
    durationMs,
    status,
    error,
    attempt,
    output: output as object,
  });
  if (tokens.input + tokens.output > 0) {
    await opts.scope.insert(usageRecords, { jobId: opts.jobId ?? null, kind: "text", provider, model: tokens.model, units: tokens.input + tokens.output, costUsd: cost.toFixed(6) });
  }
}
