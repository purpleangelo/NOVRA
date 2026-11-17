import { brandScope } from "@/lib/brand-brain/../brands/scope";
import { createEntry } from "@/lib/brand-brain/service";
import { db, makeBrand } from "./helpers";
import type { BrandInput } from "@/lib/brands/service";

/** A TEST brand with a complete, approved Brand Brain. */
export async function makeReadyBrand(over: Partial<BrandInput> = {}, tag = "Kopi") {
  const brand = await makeBrand(over);
  const { scope } = await brandScope(db(), brand.id);
  await createEntry(scope, { section: "company", data: { name: `${tag} TEST Co`, sells: `${tag} coffee beans`, markets: "Indonesia", story: "A TEST roastery." } });
  await createEntry(scope, { section: "product", data: { name: `${tag} Gayo Arabica 250g`, description: "Washed arabica from Aceh", specs: ["Altitude 1,400 m", "Medium roast"], price: "Rp 120.000", pricePublic: false } });
  await createEntry(scope, { section: "product", data: { name: `${tag} Toraja 200g`, description: "Natural process", specs: ["Altitude 1,600 m"] } });
  await createEntry(scope, { section: "audience", data: { persona: `${tag} Urban coffee lover`, description: "25-35 in Jakarta", markets: "Jakarta", languages: "Indonesian, English" } });
  await createEntry(scope, { section: "audience", data: { persona: `${tag} Home brewer`, description: "Brews pour-over at home", markets: "Indonesia", languages: "Indonesian" } });
  await createEntry(scope, { section: "voice", data: { personality: "Warm, precise", doWords: ["fresh", "origin"], dontWords: ["cheap"], sampleCaptions: ["Morning starts at the farm."] } });
  await createEntry(scope, { section: "visual", data: { colours: [{ name: "Brown", hex: "#4B2E1E" }, { name: "Cream", hex: "#F3E9DC" }, { name: "Gold", hex: "#C9A227" }], headingFont: "Playfair Display", bodyFont: "Inter", photoStyle: "Warm natural light" } });
  await createEntry(scope, { section: "claim_verified", data: { claim: "Roasted within 48 hours of shipping", source: "Roastery SOP v2" } });
  await createEntry(scope, { section: "claim_forbidden", data: { claim: "Cures fatigue", reason: "Health claim" } });
  return { brand, scope };
}
