import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "../db";
import { getSessionUser, SESSION_COOKIE, type SessionUser } from "./core";

export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  return getSessionUser(getDb(), jar.get(SESSION_COOKIE)?.value);
});

/** Use in every server component, server action and route handler that needs a logged-in operator. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}
