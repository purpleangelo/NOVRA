import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/lib/db";
import { brands } from "../src/lib/db/schema";
import { brandScope } from "../src/lib/brands/scope";
import { createBrand } from "../src/lib/brands/service";
import { uploadAsset, uploadDocument } from "../src/lib/brand-brain/uploads";
import { DOC_TYPES, UploadError } from "../src/lib/brand-brain/extract";
import { closeQueue } from "../src/lib/jobs/queue";

/**
 * Loads one folder of brand-packs/ into a brand (see brand-packs/README.md for the layout):
 *   npm run brand:import -- brand-packs/swm "Brand name" [--languages=id,en]
 * Text files and documents become Brand Brain proposals (the worker reads them; you approve them in the app),
 * logo/, fonts/ and photos/ become brand files. Creates the brand if no brand of that name exists.
 * Brand packs are confidential client data: they are only ever loaded into their own brand.
 */
const ASSET_DIRS: Record<string, "logo" | "font" | "photo"> = { logo: "logo", fonts: "font", photos: "photo" };

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const [dir, name] = args;
  const langs = (process.argv.find((a) => a.startsWith("--languages="))?.split("=")[1] ?? "id,en").split(",") as ("id" | "en")[];
  if (!dir || !name) throw new Error('Usage: npm run brand:import -- brand-packs/<folder> "Brand name" [--languages=id,en]');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder.`);

  const db = getDb();
  let [brand] = await db.select().from(brands).where(eq(brands.name, name)).limit(1);
  if (!brand) {
    brand = await createBrand(db, { name, languages: langs, platforms: ["instagram", "tiktok", "youtube_shorts", "facebook", "linkedin", "x_threads"], isTest: false });
    console.log(`Created brand ${name} (${brand.id}).`);
  } else console.log(`Adding to existing brand ${name} (${brand.id}).`);
  const { scope } = await brandScope(db, brand.id);

  let docs = 0;
  let files = 0;
  const skipped: string[] = [];
  for (const file of walk(dir)) {
    const rel = path.relative(dir, file);
    const base = path.basename(file);
    if (base.startsWith(".") || base.toLowerCase() === "readme.md") continue;
    const top = rel.split(path.sep)[0];
    const bytes = fs.readFileSync(file);
    try {
      if (rel.includes(path.sep) && ASSET_DIRS[top]) {
        await uploadAsset(scope, ASSET_DIRS[top], base, bytes);
        files++;
      } else if (DOC_TYPES[path.extname(base).toLowerCase()]) {
        await uploadDocument(scope, base, bytes);
        docs++;
      } else skipped.push(`${rel} (unsupported type)`);
    } catch (e) {
      if (e instanceof UploadError) skipped.push(`${rel} (${e.message})`);
      else throw e;
    }
  }
  console.log(`Queued ${docs} documents for reading and added ${files} brand files.`);
  if (skipped.length) console.log(`Skipped:\n- ${skipped.join("\n- ")}`);
  console.log("Start the worker (npm run worker) to read the documents, then review the proposals on the Brand Brain page.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueue();
    await closeDb();
  });
