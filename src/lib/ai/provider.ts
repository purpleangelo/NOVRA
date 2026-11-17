import Anthropic from "@anthropic-ai/sdk";

export type CompletionRequest = {
  system: string;
  user: string;
  /** JSON schema the answer must follow (structured output). */
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
  /** Used only by the mock provider (TEST data). */
  mock?: () => unknown;
};
export type CompletionResult = { text: string; inputTokens: number; outputTokens: number; model: string };

export interface TextProvider {
  readonly name: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/** Thrown when no text provider is configured. The UI shows a setup state instead of faking output. */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI provider not connected: set ANTHROPIC_API_KEY in .env (or AI_PROVIDER=mock for TEST data only).");
  }
}

/** Errors worth retrying (rate limits, overload, network, invalid JSON from the model). */
export class RetryableAiError extends Error {}

/** Price per million tokens (USD). Update in one place when pricing changes. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-2": { input: 8, output: 40 },
  mock: { input: 0, output: 0 },
};
export function costUsd(model: string, inputTokens: number, outputTokens: number) {
  const p = PRICING[model] ?? PRICING["claude-opus-5-5"];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class AnthropicProvider implements TextProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(
    apiKey: string,
    readonly model: string,
    private effort: Effort,
    private fallbacks: boolean,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: 10 * 60 * 1000 });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    try {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: req.maxTokens ?? 32000,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { effort: this.effort, format: { type: "json_schema", schema: req.jsonSchema } },
        ...(this.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw new Error(`The model declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}.`);
      if (msg.stop_reason === "max_tokens") throw new RetryableAiError("The model ran out of output tokens before finishing.");
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return { text, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, model: msg.model };
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
        throw new RetryableAiError(err.message);
      }
      if (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 408 || err.status === 409)) throw new RetryableAiError(err.message);
      throw err;
    }
  }
}

/**
 * Deterministic provider for automated tests and the TEST brand demo. Every output is produced by the
 * role's own mock function and is labelled TEST. Never used unless AI_PROVIDER=mock.
 */
export class MockProvider implements TextProvider {
  readonly name = "mock";
  readonly model = "mock";
  /** Test hook: make the next N calls fail. */
  static failNext = 0;
  static failWith: "retryable" | "fatal" = "fatal";
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (MockProvider.failNext > 0) {
      MockProvider.failNext--;
      if (MockProvider.failWith === "retryable") throw new RetryableAiError("Mock: simulated overload (529)");
      throw new Error("Mock: simulated AI API error (400 invalid_request_error)");
    }
    if (!req.mock) throw new Error("Mock provider needs a mock generator for this role.");
    const out = req.mock();
    const text = JSON.stringify(out);
    return { text, inputTokens: Math.ceil((req.system.length + req.user.length) / 4), outputTokens: Math.ceil(text.length / 4), model: "mock" };
  }
}

export function aiStatus(): { connected: boolean; provider: string; model: string; message?: string } {
  const p = process.env.AI_PROVIDER ?? "anthropic";
  if (p === "mock") return { connected: true, provider: "mock", model: "mock", message: "TEST mode: AI output is synthetic (AI_PROVIDER=mock)." };
  if (!process.env.ANTHROPIC_API_KEY) return { connected: false, provider: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5", message: new AiNotConfiguredError().message };
  return { connected: true, provider: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5" };
}

let override: TextProvider | undefined;
/** Test hook. */
export function setTextProvider(p: TextProvider | undefined) {
  override = p;
}

export function getTextProvider(): TextProvider {
  if (override) return override;
  const p = process.env.AI_PROVIDER ?? "anthropic";
  if (p === "mock") return new MockProvider();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiNotConfiguredError();
  return new AnthropicProvider(
    key,
    process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
    (process.env.ANTHROPIC_EFFORT as Effort) ?? "medium",
    (process.env.ANTHROPIC_FALLBACKS ?? "default") !== "off",
  );
}
