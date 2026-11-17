"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createSession, deleteSession, SESSION_COOKIE, verifyCredentials } from "@/lib/auth/core";
import { setSessionCookie } from "@/lib/auth/session";

export type LoginState = { error?: "invalid" | "noUser"; email?: string } | undefined;

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const db = getDb();
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n === 0) return { error: "noUser" };
  const user = await verifyCredentials(db, String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!user) return { error: "invalid", email: String(form.get("email") ?? "") };
  const { token, expiresAt } = await createSession(db, user.id);
  await setSessionCookie(token, expiresAt);
  redirect("/brands");
}

export async function logout() {
  const jar = await cookies();
  await deleteSession(getDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
