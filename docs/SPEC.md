# NOVRA — Milestone 1 Build Spec (Social Content Engine MVP)

Source of truth for Milestone 1. Read this whole file before starting any work.
Also read `docs/STATUS.md` (where the build stands) and `docs/DECISIONS.md` (assumptions made so far).

## 1. Role, product and the Milestone 1 goal

Act as a senior full-stack engineer with strong product sense for creative and social media agencies. Build working, tested software — not a mock-up, not a plan. Make reasonable technical decisions yourself, log every material assumption in `docs/DECISIONS.md`, and keep `docs/STATUS.md` current so a later session can continue.

**NOVRA** is a personal tool for ONE operator who runs a social media content agency for several brands. The tool is not sold; the operator sells the services. Its core promise: **one content plan in, a month of platform-ready posts out** — every post adapted natively for Instagram, TikTok, Facebook, LinkedIn, X/Threads and YouTube Shorts, reviewed and approved by the operator, then exported for a scheduler.

Volume target: at least 20, ideally 30+ posts per brand per month, for several brands — roughly 150 to 200 platform-ready pieces per brand per month. Design every screen and job for batch work at that volume, not one post at a time.

**Milestone 1 is done when** the operator can, with real data that survives a restart: create a brand → fill and approve its Brand Brain → generate a 30-day content plan → approve it → produce one week (7 days) of master posts with all platform variants, captions and rendered images → review them in a calendar view and an Instagram grid preview → edit, regenerate or approve each one → export the approved week as a scheduler-ready package.

## 2. Scope

| In Milestone 1 | Later milestones (design for, do not build) |
| --- | --- |
| Single operator login | Client review logins, team members |
| Brands as separate workspaces, no data shared between them | Billing, quotations, retainers |
| Brand Brain with document upload and approval | Automatic publishing to platforms |
| 30-day content plan per brand | Performance analytics and learnings |
| Master post + 6 platform variants | 100-concept pitch factory (Milestone 2) |
| Captions, hashtags, CTA in English and Indonesian | Automated video rendering |
| Image generation through ONE provider adapter | Trend research beyond web search |
| Text-on-image layout rendering with brand fonts and colours | Third-party skill registry |
| Reel/TikTok/Shorts scripts, storyboards and video prompts (text only) | Mobile app |
| Calendar view, IG grid preview, approve and revise | |
| Scheduler export: ZIP of images + CSV | |

The data model must already allow the later items (e.g. a `role` on users, a `status` that can reach `published`) so they need no rewrite.

## 3. Core workflow and the AI team

The operator works monthly, in batches. Every step that changes direction waits for the operator's approval.

1. **Create brand** — name, language(s), active platforms.
2. **Build Brand Brain** — upload documents, AI proposes entries, operator corrects and approves.
3. **Plan the month** — Strategist proposes content pillars and a 30-day plan; operator edits and approves.
4. **Produce a batch** — operator picks days (e.g. one week); the team produces master posts and all platform variants as background jobs.
5. **Review** — calendar and grid view; per post: approve, edit, regenerate copy, regenerate image, or reject with a reason.
6. **Export** — approved posts only, as a scheduler-ready package.

The AI roles are prompt-defined workers in one orchestration layer, not separate apps. Each has a versioned prompt template in `prompts/`, a typed JSON output schema (validated with Zod), and a log of every run.

| Role | Does | Output |
| --- | --- | --- |
| Strategist | Content pillars, monthly plan, post mix | Plan rows: date, pillar, format, angle, goal |
| Copywriter | Hooks, slide text, captions, hashtags, CTA per platform | Copy JSON per variant |
| Visual Director | Image prompts, layout choice, text placement | Image prompt + layout spec per variant |
| Video Producer | Reel/TikTok/Shorts hook, script, shot list, video prompts for Veo and Kling | Storyboard JSON |
| Creative Director | Brand-fit and claim check on every post before it reaches the operator | Score 1–5 per criterion + reasons + flagged claims |

The Creative Director scores brand fit, platform fit, clarity, hook strength and claim safety. Scores are editorial guidance, never presented as predicted performance. Any claim not backed by an approved Brand Brain fact is flagged.

## 4. Brand Brain

Every AI step reads only the approved Brand Brain of the brand it works for. Nothing from one brand may reach another brand's prompts, files or exports.

**Sections** (each a structured record, also exportable as Markdown):

- Company basics: name, what it sells, markets, short story
- Products: name, real specs, photos, price only if the operator marks it public
- Audience: 2 to 4 personas, markets, languages
- Voice: personality, do and don't words, 3 sample captions the operator likes
- Visual identity: logo files, colour palette (hex), fonts (uploaded font files or Google Fonts names), photo style notes, reference images
- Content pillars (drafted by the Strategist in step 3, stored here once approved)
- Claims: **verified claims** (with source) and **do-not-say claims**
- Platforms: active platforms, handles, posting frequency

**Ingestion:** accept PDF, DOCX, PPTX, XLSX, CSV, TXT, MD and images. Extract text, let the AI propose Brand Brain entries, and show each proposal with its source file and page. Nothing becomes approved until the operator accepts or edits it. Store per entry: source, status (proposed / approved / rejected), version, last-updated time.

**Integrity:** show which sections are missing before planning is allowed; flag conflicting entries (e.g. two different founding years); keep version history of every change.

## 5. Content plan, master post and platform variants

**Content plan.** One row per day for 30 days (operator can set 20 to 60 posts per month). Each row: date, pillar, format, angle (one sentence), goal (awareness / engagement / leads). Default mix, editable per brand: about 40% short video, 30% carousel, 30% single image. No two consecutive days on the same pillar and format. The operator can edit, reorder, delete or add rows before approving.

**Master post.** The platform-neutral idea: core message, hook options (3), key visual concept, CTA, which Brand Brain facts it relies on.

**Platform variants.** Generated from the master post; never the same caption pasted everywhere.

| Platform | Formats and sizes | Copy rules |
| --- | --- | --- |
| Instagram | Feed 1080×1350, carousel 3–10 slides 1080×1350, Story/Reel 1080×1920 | Hook in first line, short caption, 5–15 hashtags |
| TikTok | 1080×1920 video (storyboard + prompts), photo carousel 1080×1920 | Casual, 2-second hook, 3–5 hashtags |
| YouTube Shorts | 1080×1920 video (storyboard + prompts) | Title under 70 characters, short description |
| Facebook | 1080×1350 or 1080×1080 | Friendly, can be longer, 0–3 hashtags |
| LinkedIn | 1080×1080 image or PDF document carousel | Professional, insight first, 3–5 hashtags |
| X / Threads | 1600×900 or 1080×1080 image | Under 280 characters for X, conversational |

Copy is written in the brand's chosen language(s): English, Indonesian, or both as separate variants. Platform-specific limits (caption length, hashtag count) live in a config file, not in code, so they can be updated when platforms change.

**Video posts** in Milestone 1 produce text only: hook, script with timings, a 4–8 shot storyboard (shot, action, camera, on-screen text, duration) and one ready-to-paste prompt per shot for Google Veo and for Kling. Label them clearly as "Storyboard — video not rendered".

## 6. Rendering, review and export

**Two-layer rendering.** Image models are bad at exact text and logos, so every image post is built in two layers:

1. **Background image** from the image provider, generated from the Visual Director's prompt, OR an approved brand photo from the Brand Brain (operator chooses per post or per brand).
2. **Layout layer** rendered by the app: headline, slide text, logo and brand colours placed on the image using HTML/CSS templates rendered to PNG with Playwright (or Satori). Ship at least 6 templates: bold headline, quote, product showcase, list/tips, before-after, carousel cover + inner slide.

Image provider: implement ONE adapter interface (`generateImage(prompt, size, refs) → file`) with a fal.ai implementation first. Without a key, the app shows a clear "Image provider not connected" state and still renders layouts on brand photos or a plain brand-colour background. Never use internet or stock images as generated work.

**Cost guard.** Before any batch job, show the estimated number of AI calls and image generations and an estimated cost; the operator confirms. Store actual usage per job and per brand.

**Review screens.**

- Calendar view (month and week) showing each day's post and its status
- Instagram grid preview of the brand's next 9–12 posts, to judge the feed as a whole
- Post detail: all platform variants side by side, Creative Director scores and flags, edit copy inline, regenerate copy or image with an optional instruction, approve or reject with reason
- Every edit and regeneration creates a new version; old versions stay viewable

Statuses: `concept → draft → rendered → approved → exported` (later: `scheduled`, `published`). A storyboard can never be marked as a rendered video.

**Export.** For a chosen date range, approved posts only: a ZIP with one folder per date and platform holding the final images (and carousel slides in order), plus a CSV with date, time, platform, caption, hashtags, file names. Make the CSV column format match the bulk-upload format of one common scheduler (Metricool or Buffer — document which) and keep a generic CSV too.

## 7. Tech stack, data model and deployment

**Stack (use this, do not substitute):**

- Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- PostgreSQL with Drizzle ORM and migrations; pgvector for Brand Brain retrieval
- Background jobs: BullMQ on Redis, in a separate worker process (batch generation and rendering never run inside a web request)
- File storage: local disk volume behind authenticated routes, through a storage interface so S3/R2 can replace it later
- Rendering: Playwright (headless Chromium) in the worker
- Auth: single operator account (email + password, hashed), sessions; `role` field ready for later users
- AI: a provider interface for text models with an Anthropic implementation; model names in env config
- Docker Compose with services `web`, `worker`, `postgres`, `redis`; deployable on a VPS with Coolify

**Core tables:** users, brands, brand_brain_entries (+ versions), documents, content_plans, plan_items, master_posts, post_variants (+ versions), assets, review_events, jobs, ai_runs (prompt version, model, tokens, cost, duration, error), usage_records, exports. Every brand-owned table has `brand_id`, and every query goes through a server-side helper that enforces it.

**Engineering rules:** secrets only in `.env` (ship `.env.example`); validate all inputs and all AI JSON outputs; retry failed AI and image calls with backoff, and let an interrupted batch resume without duplicating finished posts; log every AI run; English UI with an Indonesian language switch for UI labels; light and dark theme; responsive down to tablet width.

**Deliver with the code:** `README.md` (local run + VPS/Coolify deploy steps), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/STATUS.md`, a seed script that creates one clearly labelled **TEST** brand with synthetic data, and the prompt templates in `prompts/`.

## 8. Rules, build order, acceptance tests and report

**Non-negotiable rules**

1. Working software, tested — a screen that exists but does not work is not done.
2. Never invent company facts, certifications, specs, prices, customers or results. Use only approved Brand Brain facts; flag everything else.
3. Never present stock or internet images as generated work.
4. Never call a storyboard or prompt a finished video.
5. Never let one brand's data reach another brand's prompts, files or exports.
6. Never publish, post or spend money automatically. Batch jobs need the operator's confirmation of the cost estimate.
7. Missing key, file or data → show a clear setup state and continue with what works; never fake a success.
8. Synthetic data is always labelled TEST.

**Build order** — finish and test each step before the next; update `docs/STATUS.md` and commit after each:

1. Project skeleton, Docker Compose, auth, brands, database migrations
2. Brand Brain: forms, document ingestion, proposals, approval, retrieval
3. Content plan generation, editing and approval
4. Master posts + platform variants as background jobs, with Creative Director checks
5. Layout templates and two-layer rendering, image provider adapter
6. Calendar, grid preview, post review, versions
7. Export (ZIP + CSV)
8. Acceptance tests and the report

**When blocked:** if a decision is reversible, choose the sensible default, log it in `docs/DECISIONS.md` and continue. If it needs a credential, real brand data or a choice that is hard to undo, stop that part, say exactly what is needed, and continue with the rest.

**Acceptance tests** (automated where possible, plus a written manual test script):

- [ ] Full flow on the TEST brand: create → Brand Brain approved → 30-day plan approved → 7 days produced with all 6 platform variants → reviewed → approved → exported
- [ ] Same flow on one real brand using the brand pack in `brand-packs/`
- [ ] Restart all containers: every brand, plan, post, version and file is still there
- [ ] Two brands: no fact, file or post from brand A appears anywhere in brand B
- [ ] A claim not in the Brand Brain is flagged by the Creative Director
- [ ] No image API key: app shows the setup state and still renders layouts on brand photos
- [ ] Kill the worker mid-batch, restart: the batch resumes without duplicate posts
- [ ] Invalid upload and AI API error are shown clearly and logged
- [ ] Export CSV opens correctly and matches the documented scheduler format

**Final report** (in `docs/REPORT.md` and in chat): what was built, what was tested and the results, which integrations really work, what needs credentials, what is incomplete, and exact steps to deploy on the VPS with Coolify.
