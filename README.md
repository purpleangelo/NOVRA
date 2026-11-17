# NOVRA

Personal AI social media content agency for one operator and several brands: a Brand Brain per brand, a 30-day content plan, one master post per plan item turned into variants for Instagram, TikTok, YouTube Shorts, Facebook, LinkedIn and X/Threads, rendered images, review with versions, and an export package for a scheduler (Metricool CSV or a generic CSV).

Milestone 1 is built. See `docs/REPORT.md` for what works and what still needs credentials, `docs/STATUS.md` for build steps, `docs/SPEC.md` for the spec and `docs/DECISIONS.md` for assumptions.

## What it needs

| Need | Why | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | All writing: Brand Brain extraction, plans, posts, reviews (model `claude-opus-5-5`) | The app shows a setup state for AI. `AI_PROVIDER=mock` gives synthetic output labelled TEST, for trying the flow only |
| `FAL_KEY` | Generated background images (fal.ai) | Layouts render on approved brand photos or plain brand colour, and say so |
| Brand pack in `brand-packs/<brand>/` | Real brand facts | Use the TEST brand (`npm run db:seed`) |
| `PUBLIC_MEDIA_BASE_URL` (optional) | Public image URLs in the Metricool CSV | The CSV holds paths inside the ZIP |

## Run locally with Docker (recommended)

```bash
cp .env.example .env
# edit .env: POSTGRES_PASSWORD (and the same password in DATABASE_URL), OPERATOR_EMAIL, OPERATOR_PASSWORD,
# ANTHROPIC_API_KEY (or AI_PROVIDER=mock to try it with TEST data), FAL_KEY if you have one
docker compose up -d --build
```

Open http://localhost:3000 and sign in with OPERATOR_EMAIL / OPERATOR_PASSWORD. The web container applies database migrations and creates the operator account on first start. Data lives in the Docker volumes `pgdata`, `storage` and `redisdata`.

Optional: a synthetic TEST brand with a complete Brand Brain:

```bash
docker compose exec web npx tsx scripts/seed.ts
```

Load a real brand pack (folder layout in `brand-packs/README.md`):

```bash
docker compose exec web npx tsx scripts/import-brand-pack.ts brand-packs/<folder> "Brand name" --languages=id,en
```

Documents become Brand Brain proposals once the worker has read them; review and approve them on the Brand Brain page.

## Run locally without Docker

Needs Node 22, PostgreSQL 16 with the `pgvector` extension, and Redis 7.

```bash
npm ci
npx playwright install chromium        # once, for rendering
cp .env.example .env                   # set DATABASE_URL, REDIS_URL, STORAGE_DIR=./storage, keys
npm run db:migrate
npm run user:create -- you@example.com 'a-long-password'
npm run db:seed                        # optional TEST brand
npm run dev                            # web on http://localhost:3000
npm run worker                         # in a second terminal: background jobs
```

## Tests

```bash
npm test
```

Uses the database `novra_test` (`TEST_DATABASE_URL` to change it) and Redis database 1, and runs with the mock AI provider and no image key, so it costs nothing. Includes the Milestone 1 acceptance tests (`tests/acceptance*.test.ts`), one of which starts a real worker process and kills it mid-batch. The manual test script is `docs/MANUAL_TEST.md`.

## Deploy on a VPS with Coolify

1. **Server.** A VPS with at least 2 vCPU, 4 GB RAM and 30 GB disk (Chromium rendering and Postgres). Install Coolify (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`) and open its dashboard.
2. **Repository access.** In Coolify: Sources → add a GitHub App with access to this private repository.
3. **New resource.** Projects → your project → New → Private repository (with GitHub App) → choose this repository and the branch to deploy → Build pack **Docker Compose** → compose file `docker-compose.yml`.
4. **Environment variables.** In the resource's Environment Variables, add everything from `.env.example`:
   - `POSTGRES_USER=novra`, `POSTGRES_DB=novra`, a strong `POSTGRES_PASSWORD`, and `DATABASE_URL=postgres://novra:<that password>@postgres:5432/novra`
   - `REDIS_URL=redis://redis:6379/0`, `STORAGE_DIR=/data/storage`
   - `APP_URL=https://<your domain>` (secure cookies switch on with https)
   - `OPERATOR_EMAIL`, `OPERATOR_PASSWORD` (used once, on first start)
   - `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, optionally `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`
   - `FAL_KEY`, `FAL_MODEL`, `FAL_COST_PER_IMAGE` (optional)
   - `PUBLIC_MEDIA_BASE_URL` (optional)
5. **Domain.** On the `web` service set the domain (e.g. `https://novra.example.com`) with port 3000. Coolify issues the TLS certificate. Remove the `ports: "3000:3000"` mapping from `docker-compose.yml` if you do not want port 3000 open on the server.
6. **Deploy.** Press Deploy. The first build takes several minutes (Playwright base image). Check that `web` becomes healthy (`/api/health`) and the `worker` log shows `[worker] ready`.
7. **Sign in** at your domain with OPERATOR_EMAIL / OPERATOR_PASSWORD, then remove `OPERATOR_PASSWORD` from the variables.
8. **Backups.** Back up the `pgdata` and `storage` volumes (Coolify → resource → Storages, or a scheduled `pg_dump` plus a copy of the storage volume). Brand files and rendered images are only in `storage`.
9. **Updates.** Push to the deployed branch and press Deploy (or turn on auto-deploy). Migrations run on every start of `web`.

## Layout

- `src/app` pages, server actions and API routes (Next.js App Router)
- `src/lib` brand scope, Brand Brain, plans, posts, rendering, export, jobs, AI provider
- `src/worker` background worker entry
- `prompts/` versioned prompts for each AI role
- `config/platforms.json` platform sizes, limits and posting times
- `drizzle/` SQL migrations
- `brand-packs/` confidential brand material (never commit to a public repository)

Architecture notes: `docs/ARCHITECTURE.md`. Export format: `docs/EXPORT.md`.
