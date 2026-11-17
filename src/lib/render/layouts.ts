/** Layout templates rendered by the app on top of the background (see templates.ts). */
export const LAYOUTS = {
  bold_headline: "Big headline on the image with a colour band; for statements and announcements.",
  quote: "A short quote or line in large type with quote marks; for voice, testimonials from the Brand Brain, values.",
  product_showcase: "Product in focus with name and one supporting line; for product posts.",
  list_tips: "Headline plus 3–5 short points; for tips, how-tos and checklists.",
  before_after: "Split image, left 'before' and right 'after' labels with a headline; for comparisons and transformations.",
  carousel: "Carousel: a cover slide with headline, then inner slides with heading + body text.",
} as const;
export type LayoutId = keyof typeof LAYOUTS;
export const LAYOUT_IDS = Object.keys(LAYOUTS) as LayoutId[];

export function layoutsForPrompt() {
  return LAYOUT_IDS.map((id) => `- ${id}: ${LAYOUTS[id]}`).join("\n");
}
