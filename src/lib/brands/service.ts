import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { brands } from "../db/schema";
import { PLATFORMS } from "../platforms";

export const LANGUAGES = ["en", "id"] as const;
export const FORMATS = ["short_video", "carousel", "single_image"] as const;

export const brandInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  languages: z.array(z.enum(LANGUAGES)).min(1, "Choose at least one language"),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Choose at least one platform"),
  postsPerMonth: z.coerce.number().int().min(20).max(60).default(30),
  imageSource: z.enum(["generated", "brand_photo", "plain"]).default("generated"),
  formatMix: z
    .object({ short_video: z.number().min(0), carousel: z.number().min(0), single_image: z.number().min(0) })
    .refine((m) => m.short_video + m.carousel + m.single_image === 100, "Format mix must add up to 100%")
    .default({ short_video: 40, carousel: 30, single_image: 30 }),
  isTest: z.boolean().default(false),
});
export type BrandInput = z.input<typeof brandInputSchema>;

export function slugify(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "brand"
  );
}

export async function createBrand(db: DB, input: BrandInput) {
  const data = brandInputSchema.parse(input);
  const base = slugify(data.name);
  let slug = base;
  for (let i = 2; ; i++) {
    const [taken] = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, slug)).limit(1);
    if (!taken) break;
    slug = `${base}-${i}`;
  }
  const [brand] = await db.insert(brands).values({ ...data, slug }).returning();
  return brand;
}

export async function updateBrand(db: DB, id: string, input: BrandInput) {
  const data = brandInputSchema.parse(input);
  const [brand] = await db
    .update(brands)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(brands.id, id))
    .returning();
  return brand;
}

export async function listBrands(db: DB) {
  return db.select().from(brands).where(isNull(brands.archivedAt)).orderBy(asc(brands.name));
}
