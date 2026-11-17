import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { createBrand, type BrandInput } from "@/lib/brands/service";

export const db = () => getDb();

export async function truncateAll() {
  await getDb().execute(sql`TRUNCATE users, sessions, brands RESTART IDENTITY CASCADE`);
}

let n = 0;
export async function makeBrand(over: Partial<BrandInput> = {}) {
  n++;
  return createBrand(getDb(), {
    name: `TEST Brand ${n}`,
    languages: ["en"],
    platforms: ["instagram", "tiktok", "youtube_shorts", "facebook", "linkedin", "x_threads"],
    isTest: true,
    ...over,
  });
}
