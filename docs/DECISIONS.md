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
| 2026-11-17 | Text AI: Anthropic Messages API, model from ANTHROPIC_MODEL (default `claude-opus-5-5`), effort from ANTHROPIC_EFFORT (default medium), structured JSON output (`output_config.format`) validated again with Zod, streaming, server-side refusal fallbacks on (`fallbacks: "default"`, set ANTHROPIC_FALLBACKS=off to disable) | Typed, validated output for every role. Retries: 3 attempts with 1s/4s backoff on rate limits, overload, network errors and invalid JSON. Every attempt is logged in `ai_runs` with prompt version, tokens, cost and duration. |
| 2026-11-17 | AI_PROVIDER=mock: deterministic synthetic provider for automated tests and the TEST brand only; the UI shows "TEST mode" whenever it is active | No API key was available while building; rule 7 forbids faking success with real brands, so mock output is always labelled TEST. Without a key and without mock, the app shows "AI provider not connected". |
| 2026-11-17 | Embeddings for Brand Brain retrieval: local feature-hashing embedding (256 dims) stored in pgvector, cosine distance | Anthropic has no embeddings endpoint and no other key was given. Works offline and keeps brand text on the server. Swap `src/lib/ai/embeddings.ts` for a semantic provider (e.g. Voyage) later; dimension change needs a migration. |
| 2026-11-17 | Brand Brain entries typed by the operator are approved on save; AI proposals (documents, Strategist) start as `proposed`; editing a proposal approves it | The operator is the source for typed entries; spec only requires AI proposals to wait for approval. |
| 2026-11-17 | Planning requires approved: company basics, ≥1 product, ≥2 audience personas, voice, visual identity, ≥1 claim (verified or do-not-say); and no conflicts | Matches spec section 4. Conflicts detected: same title with different content, more than one approved company/voice/visual entry, different founding years. |
| 2026-11-17 | Document ingestion: PDF via pdf-parse (per page), DOCX via mammoth, PPTX slides via JSZip (per slide), XLSX via ExcelJS (per sheet); uploads checked by extension, size (25 MB) and file signature; images become brand photos awaiting approval | Each proposal stores source document and page. Long documents are split into ~40k-character chunks without dropping text. |
| 2026-11-17 | Prices are left out of every prompt unless the product entry marks the price as public | Spec: price only if the operator marks it public. |
