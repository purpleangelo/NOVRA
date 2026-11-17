import config from "../../config/platforms.json";

export const PLATFORMS = ["instagram", "tiktok", "youtube_shorts", "facebook", "linkedin", "x_threads"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type PostFormat = "short_video" | "carousel" | "single_image";

export type PlatformFormat = { format: string; width: number; height: number; minSlides?: number; maxSlides?: number };
export type PlatformRules = {
  label: string;
  formats: Record<PostFormat, PlatformFormat>;
  caption: { maxChars: number; recommendedChars: number };
  title?: { maxChars: number };
  hashtags: { min: number; max: number };
  style: string;
  defaultTime: string;
};

const rules = config as unknown as Record<Platform, PlatformRules>;

export function platformRules(p: Platform): PlatformRules {
  return rules[p];
}
export function platformLabel(p: string) {
  return rules[p as Platform]?.label ?? p;
}
/** Format, size and slide range of a post format on a platform. */
export function variantSpec(p: Platform, format: PostFormat): PlatformFormat {
  return rules[p].formats[format];
}
export const isStoryboardFormat = (f: string) => f === "video_storyboard";
