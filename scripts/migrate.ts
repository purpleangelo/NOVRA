import { runMigrations } from "../src/lib/db/migrate";
import { closeDb } from "../src/lib/db";

runMigrations()
  .then(() => console.log("Migrations applied."))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
