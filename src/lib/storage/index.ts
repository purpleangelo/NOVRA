import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

/** Storage interface so S3/R2 can replace local disk later. Keys are always prefixed with the brand id. */
export interface Storage {
  put(key: string, data: Buffer | Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Readable;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Absolute path for tools that need a file (Playwright, zip). Local storage only. */
  localPath(key: string): string;
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/;

export class LocalDiskStorage implements Storage {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error(`Invalid storage key: ${key}`);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }
  async put(key: string, data: Buffer | Uint8Array) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }
  get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  stream(key: string) {
    return createReadStream(this.resolve(key));
  }
  async exists(key: string) {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
  localPath(key: string) {
    return this.resolve(key);
  }
}

let instance: Storage | undefined;
export function getStorage(): Storage {
  if (!instance) instance = new LocalDiskStorage(process.env.STORAGE_DIR ?? path.resolve(process.cwd(), "storage"));
  return instance;
}

export function safeFileName(name: string) {
  const base = path.basename(name).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+/, "");
  return base.slice(-120) || "file";
}

/** brands/<brandId>/<area>/<uuid>-<name> */
export function brandKey(brandId: string, area: string, fileName: string) {
  return `brands/${brandId}/${area}/${randomUUID()}-${safeFileName(fileName)}`;
}

export function keyBelongsToBrand(key: string, brandId: string) {
  return key.startsWith(`brands/${brandId}/`);
}
