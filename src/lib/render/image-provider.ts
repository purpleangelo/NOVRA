/**
 * Image provider adapter: generateImage(prompt, size, refs) → file. One implementation (fal.ai) for Milestone 1.
 * Without FAL_KEY the app reports "Image provider not connected" and renders layouts on approved brand photos
 * or a plain brand-colour background instead. Never falls back to stock or internet images.
 */
export type ImageSize = { width: number; height: number };
export type GeneratedImage = { bytes: Buffer; mimeType: string; model: string; costUsd: number };

export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  generateImage(prompt: string, size: ImageSize, refs?: Buffer[]): Promise<GeneratedImage>;
}

export class ImageProviderNotConnectedError extends Error {
  constructor() {
    super("Image provider not connected: set FAL_KEY in .env to generate background images.");
  }
}
export class ImageProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** fal.ai synchronous endpoint (https://fal.run/<model>). */
export class FalImageProvider implements ImageProvider {
  readonly name = "fal";
  constructor(
    private key: string,
    readonly model: string,
    private costPerImage: number,
  ) {}

  async generateImage(prompt: string, size: ImageSize): Promise<GeneratedImage> {
    // Models work best at multiples of 16; the renderer crops/scales to the exact post size.
    const round = (n: number) => Math.max(256, Math.round(n / 16) * 16);
    let res: Response;
    try {
      res = await fetch(`https://fal.run/${this.model}`, {
        method: "POST",
        headers: { Authorization: `Key ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, image_size: { width: round(size.width), height: round(size.height) }, num_images: 1, enable_safety_checker: true, output_format: "png" }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new ImageProviderError(`fal.ai request failed: ${(e as Error).message}`, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ImageProviderError(`fal.ai returned ${res.status}: ${body.slice(0, 300)}`, res.status === 429 || res.status >= 500);
    }
    const json = (await res.json()) as { images?: { url: string; content_type?: string }[] };
    const url = json.images?.[0]?.url;
    if (!url) throw new ImageProviderError("fal.ai returned no image", true);
    const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new ImageProviderError(`Downloading the generated image failed (${img.status})`, true);
    return { bytes: Buffer.from(await img.arrayBuffer()), mimeType: json.images![0].content_type ?? "image/png", model: this.model, costUsd: this.costPerImage };
  }
}

let override: ImageProvider | null | undefined;
/** Test hook: set a fake provider, or null to force "not connected". */
export function setImageProvider(p: ImageProvider | null | undefined) {
  override = p;
}

export function imageProviderStatus() {
  const costPerImage = Number(process.env.FAL_COST_PER_IMAGE ?? 0.025);
  if (override !== undefined) return { connected: override !== null, provider: override?.name ?? "fal", model: override?.model ?? "", costPerImage, message: override ? undefined : new ImageProviderNotConnectedError().message };
  if (!process.env.FAL_KEY) return { connected: false, provider: "fal", model: process.env.FAL_MODEL ?? "fal-ai/flux/dev", costPerImage, message: new ImageProviderNotConnectedError().message };
  return { connected: true, provider: "fal", model: process.env.FAL_MODEL ?? "fal-ai/flux/dev", costPerImage };
}

export function getImageProvider(): ImageProvider | null {
  if (override !== undefined) return override;
  const key = process.env.FAL_KEY;
  if (!key) return null;
  return new FalImageProvider(key, process.env.FAL_MODEL ?? "fal-ai/flux/dev", Number(process.env.FAL_COST_PER_IMAGE ?? 0.025));
}
