import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { sessions, users } from "../db/schema";

export const SESSION_COOKIE = "novra_session";
export const SESSION_TTL_DAYS = 30;

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
});

export type SessionUser = { id: string; email: string; name: string; role: string };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function createUser(db: DB, input: { email: string; password: string; name?: string; role?: string }) {
  const { email, password } = credentialsSchema.parse(input);
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password), name: input.name ?? "", role: input.role ?? "operator" })
    .returning();
  return user;
}

/** Returns the user when the credentials match, otherwise null. Constant-ish time for unknown emails. */
export async function verifyCredentials(db: DB, emailRaw: string, password: string) {
  const email = emailRaw.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  return user && ok ? user : null;
}

export async function createSession(db: DB, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function getSessionUser(db: DB, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSession(db: DB, token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}
