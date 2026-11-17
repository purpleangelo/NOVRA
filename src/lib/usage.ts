import { and, gte, sql } from "drizzle-orm";
import type { DB } from "./db";
import type { BrandScope } from "./brands/scope";
import { brands, usageRecords } from "./db/schema";

/** Actual cost per job id for a brand. */
export async function jobCosts(scope: BrandScope) {
  const rows = await scope.db
    .select({ jobId: usageRecords.jobId, cost: sql<string>`sum(${usageRecords.costUsd})` })
    .from(usageRecords)
    .where(scope.where(usageRecords))
    .groupBy(usageRecords.jobId);
  return new Map(rows.filter((r) => r.jobId).map((r) => [r.jobId!, Number(r.cost)]));
}

/** Usage per brand since a date: text tokens, images and cost. */
export async function usageByBrand(db: DB, since: Date) {
  return db
    .select({
      brandId: brands.id,
      brand: brands.name,
      isTest: brands.isTest,
      textUnits: sql<string>`coalesce(sum(case when ${usageRecords.kind} = 'text' then ${usageRecords.units} end), 0)`,
      images: sql<string>`coalesce(sum(case when ${usageRecords.kind} = 'image' then ${usageRecords.units} end), 0)`,
      cost: sql<string>`coalesce(sum(${usageRecords.costUsd}), 0)`,
    })
    .from(brands)
    .leftJoin(usageRecords, and(sql`${usageRecords.brandId} = ${brands.id}`, gte(usageRecords.createdAt, since)))
    .groupBy(brands.id, brands.name, brands.isTest)
    .orderBy(brands.name);
}
