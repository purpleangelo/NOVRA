# NOVRA — build status

Milestone 1 (see `docs/SPEC.md`).

| Step | What | Status |
| --- | --- | --- |
| 1 | Project skeleton, Docker Compose, auth, brands, database migrations | Done (tests: tests/step1-auth-brands.test.ts) |
| 2 | Brand Brain: forms, ingestion, proposals, approval, retrieval | Done (tests: tests/step2-brand-brain.test.ts) |
| 3 | Content plan generation, editing and approval | Done (tests: tests/step3-plan.test.ts) |
| 4 | Master posts + platform variants as background jobs, Creative Director checks | Done (tests: tests/step4-produce.test.ts) |
| 5 | Layout templates, two-layer rendering, image provider adapter | Done (tests: tests/step5-render.test.ts; fal.ai adapter untested against the live API, no key) |
| 6 | Calendar, grid preview, post review, versions | Done (tests: tests/step6-review.test.ts) |
| 7 | Export (ZIP + CSV) | Done (tests: tests/step7-export.test.ts; format in docs/EXPORT.md; Metricool headers to be checked against Metricool's current template) |
| 8 | Acceptance tests and report | Done (tests: tests/acceptance.test.ts, tests/acceptance-worker.test.ts; container restart checked by hand; real-brand test blocked on brand pack + API key; see docs/REPORT.md) |

Milestone 1 complete. Open items: real-brand acceptance run (needs `brand-packs/<brand>/` and ANTHROPIC_API_KEY), first live Anthropic and fal.ai runs, Metricool header check. See docs/REPORT.md.

## Local development

Postgres 16 with pgvector and Redis must be running. `cp .env.example .env`, set DATABASE_URL/REDIS_URL, then `npm run db:migrate` (npm scripts read `.env` themselves), `npm run user:create -- you@example.com 'long-password'`, `npm run dev` and `npm run worker`. Tests: `npm test` (uses database `novra_test`).
