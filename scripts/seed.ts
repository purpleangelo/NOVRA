import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/lib/db";
import { brands } from "../src/lib/db/schema";
import { brandScope } from "../src/lib/brands/scope";
import { createBrand } from "../src/lib/brands/service";
import { createEntry } from "../src/lib/brand-brain/service";

/**
 * Creates "Kopi Nusantara TEST", a synthetic TEST brand with a complete, approved Brand Brain, so the whole
 * flow can be tried without client data. Every fact is invented and the brand is marked TEST everywhere.
 * Safe to run twice: it does nothing when the brand exists. Usage: npm run db:seed
 */
const NAME = "Kopi Nusantara TEST";

async function main() {
  const db = getDb();
  const [existing] = await db.select({ id: brands.id }).from(brands).where(eq(brands.name, NAME)).limit(1);
  if (existing) return console.log(`${NAME} already exists (${existing.id}); nothing to do.`);
  const brand = await createBrand(db, {
    name: NAME,
    languages: ["id", "en"],
    platforms: ["instagram", "tiktok", "youtube_shorts", "facebook", "linkedin", "x_threads"],
    isTest: true,
  });
  const { scope } = await brandScope(db, brand.id);
  const entries: Parameters<typeof createEntry>[1][] = [
    { section: "company", data: { name: NAME, sells: "Single-origin Indonesian coffee beans and drip bags (synthetic TEST data)", markets: "Indonesia", story: "A TEST roastery in Bandung that buys directly from farmer groups. Invented for testing." } },
    { section: "product", data: { name: "Gayo Arabica 250g", description: "Washed arabica from Aceh, chocolate and citrus notes", specs: ["Altitude 1,400 m", "Medium roast", "Whole bean or ground"], price: "Rp 120.000", pricePublic: true } },
    { section: "product", data: { name: "Toraja Sapan 200g", description: "Natural process, red fruit and spice", specs: ["Altitude 1,600 m", "Light roast"] } },
    { section: "product", data: { name: "Drip Bag Sampler (10 pcs)", description: "Five origins, two bags each, for travel and the office", specs: ["10 g per bag"], price: "Rp 85.000", pricePublic: true } },
    { section: "audience", data: { persona: "Urban coffee lover", description: "25–35, works in Jakarta or Bandung, buys coffee online", markets: "Jabodetabek, Bandung", languages: "Indonesian, English" } },
    { section: "audience", data: { persona: "Home brewer", description: "Owns a V60 or French press and wants to learn about origins", markets: "Indonesia", languages: "Indonesian" } },
    { section: "voice", data: { personality: "Warm, precise, a little playful", doWords: ["fresh", "origin", "farmers", "craft"], dontWords: ["cheap", "best in the world"], sampleCaptions: ["Pagi dimulai dari kebun. Morning starts at the farm.", "Three minutes, one V60, a whole mountain in your cup."] } },
    { section: "visual", data: { colours: [{ name: "Coffee brown", hex: "#4B2E1E" }, { name: "Cream", hex: "#F3E9DC" }, { name: "Gold", hex: "#C9A227" }], headingFont: "Playfair Display", bodyFont: "Inter", photoStyle: "Warm natural light, wooden tables, hands and beans" } },
    { section: "claim_verified", data: { claim: "Roasted within 48 hours of shipping", source: "TEST roastery SOP v2" } },
    { section: "claim_verified", data: { claim: "Beans bought directly from farmer groups in Gayo and Toraja", source: "TEST sourcing list 2026" } },
    { section: "claim_forbidden", data: { claim: "Cures fatigue or boosts health", reason: "Health claim" } },
    { section: "claim_forbidden", data: { claim: "Best coffee in Indonesia", reason: "Unprovable superlative" } },
  ];
  for (const e of entries) await createEntry(scope, e);
  console.log(`Created ${NAME} (${brand.id}) with ${entries.length} approved Brand Brain entries. All data is synthetic.`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
