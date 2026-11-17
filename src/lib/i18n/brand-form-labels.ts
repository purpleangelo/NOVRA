import type { BrandFormLabels } from "@/components/brand-form";
import type { DictKey } from "./dict";

export function brandFormLabels(t: (k: DictKey) => string, submit: string): BrandFormLabels {
  return {
    name: t("brand.name"),
    languages: t("brand.languages"),
    platforms: t("brand.platforms"),
    postsPerMonth: t("brand.postsPerMonth"),
    imageSource: t("brand.imageSource"),
    formatMix: t("brand.formatMix"),
    submit,
    saved: t("brand.saved"),
    test: "TEST brand (synthetic data)",
    langs: { en: t("lang.en"), id: t("lang.id") },
    formats: { short_video: t("format.short_video"), carousel: t("format.carousel"), single_image: t("format.single_image") },
    images: { generated: t("image.generated"), brand_photo: t("image.brand_photo"), plain: t("image.plain") },
  };
}
