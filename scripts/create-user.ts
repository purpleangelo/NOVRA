import { count } from "drizzle-orm";
import { createUser } from "../src/lib/auth/core";
import { closeDb, getDb } from "../src/lib/db";
import { users } from "../src/lib/db/schema";

/**
 * Creates the operator account. Usage:
 *   npm run user:create -- you@example.com 'a-long-password'
 * or set OPERATOR_EMAIL / OPERATOR_PASSWORD. With --if-none it only creates the user when no user exists
 * (used on container start).
 */
async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const ifNone = process.argv.includes("--if-none");
  const email = args[0] ?? process.env.OPERATOR_EMAIL;
  const password = args[1] ?? process.env.OPERATOR_PASSWORD;
  const db = getDb();
  if (ifNone) {
    const [{ n }] = await db.select({ n: count() }).from(users);
    if (n > 0) return console.log("Operator account exists; nothing to do.");
  }
  if (!email || !password) {
    console.log("No OPERATOR_EMAIL / OPERATOR_PASSWORD given; skipping user creation.");
    return;
  }
  const user = await createUser(db, { email, password, role: "operator" });
  console.log(`Created operator ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
