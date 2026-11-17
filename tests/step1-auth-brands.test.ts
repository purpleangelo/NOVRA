import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/lib/db";
import { createSession, createUser, deleteSession, getSessionUser, verifyCredentials } from "@/lib/auth/core";
import { brandScope, BrandNotFoundError, NotFoundError } from "@/lib/brands/scope";
import { brandInputSchema, slugify, updateBrand } from "@/lib/brands/service";
import { documents, users } from "@/lib/db/schema";
import { getStorage, keyBelongsToBrand, brandKey, LocalDiskStorage } from "@/lib/storage";
import { db, makeBrand, truncateAll } from "./helpers";

beforeEach(truncateAll);
afterAll(closeDb);

describe("auth", () => {
  it("hashes passwords and verifies credentials", async () => {
    const u = await createUser(db(), { email: "Op@Example.com", password: "correct horse battery" });
    expect(u.email).toBe("op@example.com");
    expect(u.role).toBe("operator");
    const [row] = await db().select().from(users).where(eq(users.id, u.id));
    expect(row.passwordHash).not.toContain("correct");
    expect(await verifyCredentials(db(), "op@example.com", "correct horse battery")).toBeTruthy();
    expect(await verifyCredentials(db(), "op@example.com", "wrong password!!")).toBeNull();
    expect(await verifyCredentials(db(), "nobody@example.com", "correct horse battery")).toBeNull();
  });

  it("rejects short passwords", async () => {
    await expect(createUser(db(), { email: "a@b.co", password: "short" })).rejects.toThrow();
  });

  it("creates, reads and deletes sessions", async () => {
    const u = await createUser(db(), { email: "op@example.com", password: "correct horse battery" });
    const { token } = await createSession(db(), u.id);
    expect((await getSessionUser(db(), token))?.email).toBe("op@example.com");
    expect(await getSessionUser(db(), "made-up-token")).toBeNull();
    await deleteSession(db(), token);
    expect(await getSessionUser(db(), token)).toBeNull();
  });
});

describe("brands", () => {
  it("validates brand input", () => {
    expect(brandInputSchema.safeParse({ name: "X", languages: ["en"], platforms: ["instagram"] }).success).toBe(false);
    expect(brandInputSchema.safeParse({ name: "Brand", languages: [], platforms: ["instagram"] }).success).toBe(false);
    expect(
      brandInputSchema.safeParse({ name: "Brand", languages: ["en"], platforms: ["instagram"], formatMix: { short_video: 50, carousel: 30, single_image: 30 } }).success,
    ).toBe(false);
    expect(brandInputSchema.safeParse({ name: "Brand", languages: ["en", "id"], platforms: ["instagram"], postsPerMonth: 61 }).success).toBe(false);
  });

  it("creates brands with unique slugs and updates them", async () => {
    const a = await makeBrand({ name: "Kopi Nusantara" });
    const b = await makeBrand({ name: "Kopi Nusantara" });
    expect(a.slug).toBe("kopi-nusantara");
    expect(b.slug).toBe("kopi-nusantara-2");
    expect(slugify("Ünïcode Brand!!")).toBe("unicode-brand");
    const updated = await updateBrand(db(), a.id, { name: "Kopi N", languages: ["id"], platforms: ["instagram"], postsPerMonth: 20 });
    expect(updated.languages).toEqual(["id"]);
    expect(updated.postsPerMonth).toBe(20);
  });

  it("BrandScope never returns or changes another brand's rows", async () => {
    const a = await makeBrand();
    const b = await makeBrand();
    const { scope: sa } = await brandScope(db(), a.id);
    const { scope: sb } = await brandScope(db(), b.id);
    const [docA] = await sa.insert(documents, { fileName: "a.txt", mimeType: "text/plain", size: 1, storageKey: brandKey(a.id, "docs", "a.txt") });
    expect(docA.brandId).toBe(a.id);
    // Even if a caller passes brandId in values, the scope overrides it.
    const [sneaky] = await sb.insert(documents, { fileName: "b.txt", mimeType: "text/plain", size: 1, storageKey: "x", ...({ brandId: a.id } as object) });
    expect(sneaky.brandId).toBe(b.id);
    expect((await sb.select(documents)).map((d) => d.id)).toEqual([sneaky.id]);
    await expect(sb.get(documents, docA.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await sb.update(documents, { fileName: "hacked" }, eq(documents.id, docA.id))).toHaveLength(0);
    expect(await sb.delete(documents, eq(documents.id, docA.id))).toHaveLength(0);
    expect((await sa.get(documents, docA.id)).fileName).toBe("a.txt");
    await expect(brandScope(db(), "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(BrandNotFoundError);
  });
});

describe("storage", () => {
  it("stores files under brand-prefixed keys and rejects path traversal", async () => {
    const s = getStorage();
    const key = brandKey("brand-1", "docs", "../../etc/passwd");
    expect(key).toMatch(/^brands\/brand-1\/docs\/[0-9a-f-]+-passwd$/);
    await s.put(key, Buffer.from("hello"));
    expect((await s.get(key)).toString()).toBe("hello");
    expect(keyBelongsToBrand(key, "brand-1")).toBe(true);
    expect(keyBelongsToBrand(key, "brand-2")).toBe(false);
    const local = new LocalDiskStorage("/tmp/x");
    expect(() => local.localPath("../secret")).toThrow();
    expect(() => local.localPath("/etc/passwd")).toThrow();
  });
});
