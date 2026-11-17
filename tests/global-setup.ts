import { Client } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import path from "node:path";
import fs from "node:fs/promises";

/** Resets the test database (public schema) and applies all migrations once per test run. */
export default async function setup() {
  const url = process.env.DATABASE_URL!;
  if (!/test/.test(url)) throw new Error(`Refusing to reset non-test database: ${url}`);
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await migrate(drizzle(client), { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  await client.end();
  await fs.rm(process.env.STORAGE_DIR!, { recursive: true, force: true });
}
