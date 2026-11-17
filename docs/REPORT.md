# NOVRA Milestone 1 report

Date: 2026-11-17. Branch: `claude/project-thread-gzwrhy`.

## What was built

All eight build steps of `docs/SPEC.md` §8:

1. **Skeleton:** Next.js 15 app, worker, PostgreSQL 16 + pgvector, Redis/BullMQ, Docker Compose (web, worker, postgres, redis), operator sign-in, brands (name, languages, platforms, TEST flag), SQL migrations.
2. **Brand Brain:** forms for every section, document upload (PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, images), AI extraction into proposals with source file and page, approve/reject/edit with version history, integrity check, retrieval for prompts (non-public prices hidden), Markdown export.
3. **Content plan:** 30-day plan from the Strategist with pillar and format mix rules, editing (edit, move, add, delete), approval and locking.
4. **Production:** master post per plan item, copy per platform and language within platform limits, visual direction, video storyboards, Creative Director scores plus a rule-based claim guard, all as background jobs with a cost estimate that must be confirmed.
5. **Rendering:** six HTML/CSS layouts rendered to PNG at each platform's size, on a generated background (fal.ai), an approved brand photo or plain brand colour; TEST mark on TEST brands.
6. **Review:** calendar, Instagram grid preview, post page with all variants, inline edits, copy and image regeneration, versions, approve/reject per variant or post, bulk approve of clean posts.
7. **Export:** ZIP per date range with per-date, per-platform folders, Metricool bulk CSV, generic CSV, README (`docs/EXPORT.md`).
8. **Acceptance:** automated acceptance tests, a manual test script (`docs/MANUAL_TEST.md`), a TEST brand seed (`npm run db:seed`), a brand pack importer (`npm run brand:import`), this report, deploy steps in `README.md`.

## Tests and results

`npm test`: 55 tests in 9 files, all passing (mock AI provider, no image key, so no cost). TypeScript and `next build` pass.

| Acceptance test (SPEC §8) | How it was checked | Result |
| --- | --- | --- |
| Full flow on the TEST brand | `tests/acceptance.test.ts`: create brand → upload document → approve proposals → 30-day plan job → approve → estimate, confirm, produce 7 days × 6 platforms → edit (version 2) → approve → export | Pass |
| Same flow on a real brand | Not run: `brand-packs/` holds only the README, and there is no Anthropic key | **Blocked** (needs the brand pack and the key) |
| Restart all containers, everything still there | Docker Compose on this machine: seeded the TEST brand, produced 2 posts through the real worker container, edited one (new version), then `docker compose down` and `up`. Counts before and after: 1 brand, 16 Brand Brain entries, 1 plan, 2 posts, 24 variants, 25 versions, 38 files, all 38 files readable; sign-in and grid images worked after restart | Pass |
| Two brands, no leakage | `tests/acceptance.test.ts`: full flow on two brands, then every prompt sent for brand B, its Brand Brain, posts, variants, AI logs, file keys and export checked for brand A's names; B's scope cannot read A's post by id | Pass |
| Claim not in the Brand Brain is flagged | `tests/acceptance.test.ts` and step 4/6 tests ("best coffee in Asia, ISO 9001 certified" gets flagged, claim-safety score ≤ 2) | Pass |
| No image key: setup state, renders on brand photos | `tests/acceptance.test.ts`: status says FAL_KEY is missing, variants render on the approved brand photo and say so | Pass |
| Kill the worker mid-batch, resume without duplicates | `tests/acceptance-worker.test.ts`: a real worker process and BullMQ queue; SIGKILL after 2 posts, restart, batch completes with exactly one post per plan item and 6 variants each | Pass |
| Invalid upload and AI API error shown and logged | `tests/acceptance.test.ts` and step 2 tests: wrong type and fake PDF refused with a clear message, nothing stored; an AI API error fails the job with the message and is logged in AI runs | Pass |
| Export CSV opens correctly and matches the documented format | `tests/step7-export.test.ts`: CSVs parsed back (BOM, quoting, CRLF), headers and every row checked against `docs/EXPORT.md`, slide order, storyboards as text | Pass (Metricool header names need checking, below) |

Problems found and fixed while testing step 8: `src/lib/storage` was excluded by a too-broad `.gitignore` rule, so a fresh clone could not build (fixed and pushed); the queue's Redis connection kept CLI scripts from exiting (fixed); brand packs are now kept out of the Docker image and mounted read-only.

## Which integrations really work

| Integration | State |
| --- | --- |
| PostgreSQL + pgvector, Redis/BullMQ, local file storage, Docker Compose | Working, tested |
| Playwright/Chromium rendering | Working, tested, including inside the Docker image |
| Anthropic API (Claude, `claude-opus-5-5`, structured JSON output, retries, logging) | Code complete, **not run against the live API**: no key was available. Every test used the mock provider |
| fal.ai image generation | Code complete, **not run against the live API**: no key |
| Metricool | Export file only (no API). Column names follow Metricool's bulk template from memory and must be compared with the current template once |

## What needs credentials or data

- `ANTHROPIC_API_KEY`: needed for any real content. Recommended first check: one document ingestion and one 7-day batch on the TEST brand, then compare cost with the estimate (Jobs page).
- `FAL_KEY` (and the per-image price in `FAL_COST_PER_IMAGE`): for generated backgrounds.
- A real brand pack in `brand-packs/<brand>/`: for the real-brand acceptance test (`npm run brand:import`).
- Optional `PUBLIC_MEDIA_BASE_URL`: public hosting for export images so Metricool can fetch them.

## What is incomplete or limited

- Real-brand acceptance test not run (no brand pack, no key).
- Live Anthropic and fal.ai calls untested; prompt quality with the real model is unknown until the first run.
- Metricool CSV header names to be checked against Metricool's current template (`docs/EXPORT.md`).
- Video is storyboard only, by design for Milestone 1: no video files are produced.
- No publishing or scheduling API: export only, by design.
- One operator account; no roles or team features.

## Deploy on the VPS with Coolify

Full steps are in `README.md` → "Deploy on a VPS with Coolify". In short: install Coolify, connect the private GitHub repository through a GitHub App, create a Docker Compose resource from `docker-compose.yml`, add the environment variables from `.env.example` (strong Postgres password in both `POSTGRES_PASSWORD` and `DATABASE_URL`, `APP_URL` with https, operator email and password, API keys), set the domain on the `web` service at port 3000, deploy, sign in, then remove `OPERATOR_PASSWORD` and set up backups of the `pgdata` and `storage` volumes.
