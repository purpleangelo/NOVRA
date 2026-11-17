import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DB } from "../db";
import { brands } from "../db/schema";

type BrandOwnedTable = PgTable & { brandId: PgColumn; id: PgColumn };

export class BrandNotFoundError extends Error {
  constructor(id: string) {
    super(`Brand ${id} not found`);
  }
}
export class NotFoundError extends Error {}

/**
 * Every query on brand-owned data goes through a BrandScope. It adds `brand_id = <brand>` to every
 * read, update and delete, and stamps brand_id on every insert, so data of one brand can never be
 * read or written while working for another.
 */
export class BrandScope {
  constructor(
    readonly db: DB,
    readonly brandId: string,
  ) {}

  /** `brand_id = this.brandId AND ...conditions` */
  where<T extends BrandOwnedTable>(table: T, ...conditions: (SQL | undefined)[]): SQL {
    return and(eq(table.brandId, this.brandId), ...conditions)!;
  }

  select<T extends BrandOwnedTable>(table: T, ...conditions: (SQL | undefined)[]) {
    return this.db.select().from(table as PgTable).where(this.where(table, ...conditions)) as unknown as Promise<T["$inferSelect"][]>;
  }

  async get<T extends BrandOwnedTable>(table: T, id: string): Promise<T["$inferSelect"]> {
    const [row] = await this.select(table, eq(table.id, id));
    if (!row) throw new NotFoundError(`Not found in this brand`);
    return row;
  }

  async insert<T extends BrandOwnedTable>(table: T, values: Omit<T["$inferInsert"], "brandId"> | Omit<T["$inferInsert"], "brandId">[]) {
    const list = (Array.isArray(values) ? values : [values]).map((v) => ({ ...v, brandId: this.brandId }));
    if (list.length === 0) return [] as T["$inferSelect"][];
    return (await this.db.insert(table).values(list as T["$inferInsert"][]).returning()) as T["$inferSelect"][];
  }

  async update<T extends BrandOwnedTable>(table: T, set: Partial<Omit<T["$inferInsert"], "brandId">>, ...conditions: (SQL | undefined)[]) {
    return (await this.db
      .update(table)
      .set(set as never)
      .where(this.where(table, ...conditions))
      .returning()) as T["$inferSelect"][];
  }

  async delete<T extends BrandOwnedTable>(table: T, ...conditions: (SQL | undefined)[]) {
    return (await this.db.delete(table).where(this.where(table, ...conditions)).returning()) as T["$inferSelect"][];
  }
}

export async function brandScope(db: DB, brandId: string) {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
  if (!brand) throw new BrandNotFoundError(brandId);
  return { scope: new BrandScope(db, brandId), brand };
}
