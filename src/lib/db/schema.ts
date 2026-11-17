import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** pgvector column. Dimension is fixed by the embedding provider (see lib/ai/embeddings.ts). */
export const EMBEDDING_DIM = 256;
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIM})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return String(value)
      .replace(/[[\]]/g, "")
      .split(",")
      .filter(Boolean)
      .map(Number);
  },
});

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const brandRef = () =>
  uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" });

// ---------------------------------------------------------------- users & auth

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  /** operator | team | client — only "operator" is used in Milestone 1. */
  role: text("role").notNull().default("operator"),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  /** sha256 of the session token; the raw token only lives in the cookie. */
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- brands

export const brands = pgTable("brands", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** "en" | "id" */
  languages: text("languages").array().notNull().default(sql`ARRAY['en']::text[]`),
  /** instagram | tiktok | youtube_shorts | facebook | linkedin | x_threads */
  platforms: text("platforms").array().notNull().default(sql`ARRAY[]::text[]`),
  isTest: boolean("is_test").notNull().default(false),
  postsPerMonth: integer("posts_per_month").notNull().default(30),
  /** { short_video: 40, carousel: 30, single_image: 30 } */
  formatMix: jsonb("format_mix").$type<Record<string, number>>().notNull().default({ short_video: 40, carousel: 30, single_image: 30 }),
  /** generated | brand_photo | plain */
  imageSource: text("image_source").notNull().default("generated"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// ---------------------------------------------------------------- brand brain

export const documents = pgTable(
  "documents",
  {
    id: id(),
    brandId: brandRef(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    /** uploaded | extracted | proposed | failed */
    status: text("status").notNull().default("uploaded"),
    error: text("error"),
    /** [{ page: 1, text: "..." }] */
    pages: jsonb("pages").$type<{ page: number; text: string }[]>(),
    createdAt: createdAt(),
  },
  (t) => [index("documents_brand_idx").on(t.brandId)],
);

export const brandBrainEntries = pgTable(
  "brand_brain_entries",
  {
    id: id(),
    brandId: brandRef(),
    /** company | product | audience | voice | visual | pillar | claim_verified | claim_forbidden | platform */
    section: text("section").notNull(),
    /** Short label: e.g. product name, persona name, "Founding year". */
    title: text("title").notNull(),
    /** Structured section fields; the shape per section is validated in lib/brand-brain/sections.ts */
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    /** proposed | approved | rejected */
    status: text("status").notNull().default("proposed"),
    version: integer("version").notNull().default(1),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "set null" }),
    /** e.g. "page 3" */
    sourceLocation: text("source_location"),
    /** manual | document | strategist */
    sourceKind: text("source_kind").notNull().default("manual"),
    embedding: vector("embedding"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bbe_brand_idx").on(t.brandId, t.section)],
);

export const brandBrainEntryVersions = pgTable(
  "brand_brain_entry_versions",
  {
    id: id(),
    brandId: brandRef(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => brandBrainEntries.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("bbev_entry_idx").on(t.entryId)],
);

// ---------------------------------------------------------------- planning

export const contentPlans = pgTable(
  "content_plans",
  {
    id: id(),
    brandId: brandRef(),
    /** First day of the plan period */
    startDate: date("start_date").notNull(),
    days: integer("days").notNull().default(30),
    postsCount: integer("posts_count").notNull().default(30),
    /** draft | approved | archived */
    status: text("status").notNull().default("draft"),
    formatMix: jsonb("format_mix").$type<Record<string, number>>().notNull(),
    pillars: jsonb("pillars").$type<{ name: string; description: string }[]>().notNull().default([]),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("plans_brand_idx").on(t.brandId)],
);

export const planItems = pgTable(
  "plan_items",
  {
    id: id(),
    brandId: brandRef(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => contentPlans.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    position: integer("position").notNull(),
    pillar: text("pillar").notNull(),
    /** short_video | carousel | single_image */
    format: text("format").notNull(),
    angle: text("angle").notNull(),
    /** awareness | engagement | leads */
    goal: text("goal").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("plan_items_plan_idx").on(t.planId, t.position)],
);

// ---------------------------------------------------------------- posts

export const masterPosts = pgTable(
  "master_posts",
  {
    id: id(),
    brandId: brandRef(),
    planItemId: uuid("plan_item_id")
      .notNull()
      .references(() => planItems.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    format: text("format").notNull(),
    pillar: text("pillar").notNull(),
    coreMessage: text("core_message").notNull(),
    hooks: jsonb("hooks").$type<string[]>().notNull(),
    visualConcept: text("visual_concept").notNull(),
    cta: text("cta").notNull(),
    /** Brand Brain entry ids the post relies on */
    factIds: jsonb("fact_ids").$type<string[]>().notNull().default([]),
    /** concept | draft | rendered | approved | exported | rejected (later: scheduled | published) */
    status: text("status").notNull().default("concept"),
    review: jsonb("review").$type<CreativeReview | null>(),
    rejectReason: text("reject_reason"),
    imageSource: text("image_source"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("master_posts_plan_item_uq").on(t.planItemId), index("master_posts_brand_date_idx").on(t.brandId, t.date)],
);

export type CreativeReview = {
  scores: { brandFit: number; platformFit: number; clarity: number; hookStrength: number; claimSafety: number };
  reasons: Record<string, string>;
  flaggedClaims: { claim: string; reason: string; variant?: string }[];
  reviewedAt: string;
};

export const postVariants = pgTable(
  "post_variants",
  {
    id: id(),
    brandId: brandRef(),
    masterPostId: uuid("master_post_id")
      .notNull()
      .references(() => masterPosts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    language: text("language").notNull(),
    /** feed_image | carousel | story | video_storyboard | photo_carousel | document_carousel */
    format: text("format").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    copy: jsonb("copy").$type<VariantCopy>().notNull(),
    visual: jsonb("visual").$type<VariantVisual | null>(),
    storyboard: jsonb("storyboard").$type<Storyboard | null>(),
    /** draft | rendered | approved | exported | rejected */
    status: text("status").notNull().default("draft"),
    renderError: text("render_error"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("post_variants_uq").on(t.masterPostId, t.platform, t.language),
    index("post_variants_brand_idx").on(t.brandId),
  ],
);

export type VariantCopy = {
  hook: string;
  caption: string;
  hashtags: string[];
  cta: string;
  title?: string;
  slides?: { heading: string; body: string }[];
};
export type VariantVisual = {
  imagePrompt: string;
  layout: string;
  headline: string;
  subtext?: string;
  textPlacement: "top" | "center" | "bottom";
};
export type Storyboard = {
  label: string;
  hook: string;
  script: { start: number; end: number; line: string }[];
  shots: { shot: number; action: string; camera: string; onScreenText: string; duration: number; veoPrompt: string; klingPrompt: string }[];
};

export const postVariantVersions = pgTable(
  "post_variant_versions",
  {
    id: id(),
    brandId: brandRef(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => postVariants.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    copy: jsonb("copy").$type<VariantCopy>().notNull(),
    visual: jsonb("visual").$type<VariantVisual | null>(),
    storyboard: jsonb("storyboard").$type<Storyboard | null>(),
    assetIds: jsonb("asset_ids").$type<string[]>().notNull().default([]),
    /** generated | edit | regenerate_copy | regenerate_image | render */
    reason: text("reason").notNull(),
    instruction: text("instruction"),
    createdAt: createdAt(),
  },
  (t) => [index("pvv_variant_idx").on(t.variantId)],
);

export const assets = pgTable(
  "assets",
  {
    id: id(),
    brandId: brandRef(),
    /** logo | font | photo | reference | background | render | slide */
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    variantId: uuid("variant_id").references(() => postVariants.id, { onDelete: "cascade" }),
    variantVersion: integer("variant_version"),
    slideIndex: integer("slide_index"),
    /** upload | generated | brand_photo | plain */
    origin: text("origin").notNull().default("upload"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("assets_brand_idx").on(t.brandId, t.kind), index("assets_variant_idx").on(t.variantId)],
);

export const reviewEvents = pgTable(
  "review_events",
  {
    id: id(),
    brandId: brandRef(),
    masterPostId: uuid("master_post_id").references(() => masterPosts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => postVariants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** approve | reject | edit | regenerate_copy | regenerate_image | comment */
    action: text("action").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("review_events_post_idx").on(t.masterPostId)],
);

// ---------------------------------------------------------------- jobs & usage

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    brandId: brandRef(),
    /** produce_batch | render_batch | regenerate_copy | regenerate_image | ingest_document | generate_plan */
    type: text("type").notNull(),
    /** awaiting_confirmation | queued | running | completed | failed | cancelled */
    status: text("status").notNull().default("awaiting_confirmation"),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    estimate: jsonb("estimate").$type<JobEstimate | null>(),
    progress: jsonb("progress").$type<{ done: number; total: number; message?: string }>().notNull().default({ done: 0, total: 0 }),
    error: text("error"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_brand_idx").on(t.brandId, t.createdAt)],
);

export type JobEstimate = { aiCalls: number; imageGenerations: number; estimatedCostUsd: number; notes: string[] };

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: id(),
    brandId: brandRef(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    /** strategist | copywriter | visual_director | video_producer | creative_director | brand_brain_extractor */
    role: text("role").notNull(),
    promptVersion: text("prompt_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    durationMs: integer("duration_ms").notNull().default(0),
    /** ok | error */
    status: text("status").notNull(),
    error: text("error"),
    attempt: integer("attempt").notNull().default(1),
    output: jsonb("output"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_runs_brand_idx").on(t.brandId, t.createdAt)],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: id(),
    brandId: brandRef(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    /** text | image */
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    units: integer("units").notNull().default(1),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: createdAt(),
  },
  (t) => [index("usage_brand_idx").on(t.brandId, t.createdAt)],
);

export const exportsTable = pgTable(
  "exports",
  {
    id: id(),
    brandId: brandRef(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    /** completed | failed */
    status: text("status").notNull(),
    storageKey: text("storage_key"),
    postCount: integer("post_count").notNull().default(0),
    fileCount: integer("file_count").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("exports_brand_idx").on(t.brandId)],
);
