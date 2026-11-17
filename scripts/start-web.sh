#!/bin/sh
set -e
npx tsx scripts/migrate.ts
npx tsx scripts/create-user.ts --if-none
exec npx next start -p 3000
