import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import type { BrandScope } from "../brands/scope";
import { assets, documents } from "../db/schema";
import { createJob } from "../jobs/service";
import { brandKey, getStorage } from "../storage";
import { UploadError, validateUpload } from "./extract";

/** Stores an uploaded brand document and queues its ingestion. Invalid uploads throw UploadError (shown to the operator). */
export async function uploadDocument(scope: BrandScope, fileName: string, bytes: Buffer) {
  const type = validateUpload(fileName, bytes);
  const key = brandKey(scope.brandId, "documents", fileName);
  await getStorage().put(key, bytes);
  const [doc] = await scope.insert(documents, { fileName: path.basename(fileName), mimeType: type.mime, size: bytes.length, storageKey: key, status: "uploaded" });
  const job = await createJob(scope, "ingest_document", { documentId: doc.id }, { autoStart: true, estimate: { aiCalls: type.kind === "text" ? 1 : 0, imageGenerations: 0, estimatedCostUsd: 0, notes: ["Document reading"] } });
  return { doc, job };
}

export type AssetKind = "logo" | "font" | "photo" | "reference";
const ASSET_TYPES: Record<AssetKind, Record<string, string>> = {
  logo: { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" },
  font: { ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2" },
  photo: { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" },
  reference: { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" },
};

/** Visual identity files uploaded by the operator (approved on upload, since the operator chose them). */
export async function uploadAsset(scope: BrandScope, kind: AssetKind, fileName: string, bytes: Buffer, meta: Record<string, unknown> = {}) {
  const ext = path.extname(fileName).toLowerCase();
  const mime = ASSET_TYPES[kind]?.[ext];
  if (!mime) throw new UploadError(`"${fileName}": ${ext || "no extension"} is not allowed for a ${kind}. Allowed: ${Object.keys(ASSET_TYPES[kind]).join(", ")}`);
  if (!bytes.length) throw new UploadError(`"${fileName}" is empty.`);
  if (bytes.length > 25 * 1024 * 1024) throw new UploadError(`"${fileName}" is larger than 25 MB.`);
  if (ext === ".svg") {
    const text = bytes.toString("utf8");
    if (!/<svg[\s>]/i.test(text)) throw new UploadError(`"${fileName}" is not a valid SVG.`);
    if (/<script|\son\w+\s*=|javascript:/i.test(text)) throw new UploadError(`"${fileName}" contains scripts; upload a clean SVG or a PNG.`);
  } else if (kind !== "font") {
    validateUpload(fileName, bytes); // image signature check
  }
  const key = brandKey(scope.brandId, `assets/${kind}`, fileName);
  await getStorage().put(key, bytes);
  const [asset] = await scope.insert(assets, { kind, fileName: path.basename(fileName), storageKey: key, mimeType: mime, size: bytes.length, origin: "upload", meta: { approved: true, ...meta } });
  return asset;
}

export async function setPhotoApproval(scope: BrandScope, assetId: string, approved: boolean) {
  const a = await scope.get(assets, assetId);
  await scope.update(assets, { meta: { ...a.meta, approved } }, eq(assets.id, assetId));
}

export async function deleteAsset(scope: BrandScope, assetId: string) {
  const a = await scope.get(assets, assetId);
  if (!["logo", "font", "photo", "reference"].includes(a.kind)) throw new UploadError("Only brand files can be deleted here.");
  await scope.delete(assets, eq(assets.id, assetId));
  await getStorage().delete(a.storageKey);
}

export async function brandFiles(scope: BrandScope) {
  return scope.db
    .select()
    .from(assets)
    .where(and(scope.where(assets), sql`${assets.kind} in ('logo','font','photo','reference')`))
    .orderBy(assets.createdAt);
}

export async function approvedPhotos(scope: BrandScope) {
  return (await brandFiles(scope)).filter((a) => a.kind === "photo" && a.meta.approved === true);
}
