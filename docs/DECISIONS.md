# NOVRA — decisions log

Record every material assumption or technical choice here: date, decision, reason, how to change it.

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-11-17 | Product name NOVRA; personal operator tool, services sold, tool not sold | Operator decision |
| 2026-11-17 | Milestone 1 = social media content engine; 100-concept pitch factory moved to Milestone 2 | Keep first build focused |
| 2026-11-17 | Image provider: fal.ai adapter first | One key gives access to many image models |
| 2026-11-17 | Hosting: VPS with Coolify, Docker Compose | Batch jobs and rendering need a long-running worker |
| 2026-11-17 | Next.js 15.5 (App Router), React 19, Tailwind v4, TypeScript 5.9 | Next 15 is the mature line; TypeScript 7 broke the Next 15 build, so TS is pinned to 5.9. Upgrade by bumping versions in package.json. |
| 2026-11-17 | shadcn/ui components are written into `src/components/ui/` by hand in shadcn style (cva + tailwind-merge + Radix Slot) | Same result as the shadcn CLI (copied source), no registry call needed at build time. Add more with `npx shadcn add` later if wanted. |
| 2026-11-17 | Auth: email + bcrypt (cost 12) password, random 32-byte session token in an httpOnly cookie, only its SHA-256 stored in `sessions`, 30-day expiry | Simple, no third-party auth service for a single operator. `users.role` exists for later team/client logins. |
| 2026-11-17 | Operator account is created by `npm run user:create -- email password`, or on first container start from OPERATOR_EMAIL / OPERATOR_PASSWORD | No public sign-up page for a single-operator tool. |
| 2026-11-17 | Brand isolation: every brand-owned query goes through `BrandScope` (`src/lib/brands/scope.ts`), which adds `brand_id = ?` to reads/updates/deletes and overwrites `brand_id` on inserts; file keys are `brands/<brandId>/...` | Enforces rule 5 in one place; covered by tests. |
| 2026-11-17 | One Docker image for `web` and `worker`, based on `mcr.microsoft.com/playwright:v1.63.0-noble`; web runs migrations and creates the operator on start | Worker needs Chromium; one image keeps Coolify setup to one build. Playwright npm package pinned to 1.63.0 to match the image. |
| 2026-11-17 | Postgres image `pgvector/pgvector:pg16`; migration 0000 enables the `vector` extension | pgvector required for Brand Brain retrieval. |
| 2026-11-17 | Tests: Vitest against a separate `novra_test` database that is reset and migrated on every run; AI_PROVIDER=mock in tests | Real integration tests without spending money or touching real data. |
| 2026-11-17 | UI language switch (EN/ID) and theme stored in cookies `novra_lang` / `novra_theme` | No account settings table needed. |
