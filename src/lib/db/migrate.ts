import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { getDb } from "./index";

export async function runMigrations() {
  await migrate(getDb(), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
}
