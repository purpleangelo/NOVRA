import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __novraPool?: Pool; __novraDb?: DB };

export function getPool(): Pool {
  if (!globalForDb.__novraPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    globalForDb.__novraPool = new Pool({ connectionString: url, max: 10 });
  }
  return globalForDb.__novraPool;
}

export function getDb(): DB {
  if (!globalForDb.__novraDb) globalForDb.__novraDb = drizzle(getPool(), { schema });
  return globalForDb.__novraDb;
}

export async function closeDb() {
  if (globalForDb.__novraPool) {
    await globalForDb.__novraPool.end();
    globalForDb.__novraPool = undefined;
    globalForDb.__novraDb = undefined;
  }
}

export { schema };
