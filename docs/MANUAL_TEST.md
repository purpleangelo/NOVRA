# Manual test script (Milestone 1)

Run on a fresh install (`docker compose up -d --build`). Tick each line; write down anything that differs. Steps marked (key) need the real API key; with `AI_PROVIDER=mock` they still work but every text is synthetic and labelled TEST.

## A. TEST brand, full flow

1. Sign in with OPERATOR_EMAIL / OPERATOR_PASSWORD. Wrong password shows an error.
2. `docker compose exec web npx tsx scripts/seed.ts`. Brands list shows "Kopi Nusantara TEST" with a TEST badge.
3. Brand Brain: every section shows approved entries; the integrity panel says ready for planning. Upload a small PDF or DOCX: a job appears; when it finishes, proposals appear with source file and page. Approve one, reject one, edit one (a new version appears in its history).
4. Brand files: upload a logo (SVG or PNG) and 2–3 photos; approve the photos.
5. Content plan: generate 30 days. Check the pillar and format mix, edit one row, move one, delete one, add one. Approve the plan.
6. Produce: select the first 7 days. The cost estimate shows AI calls and images and the image provider status. Nothing runs until you press Confirm. Confirm.
7. Jobs: the batch shows progress and, when done, the actual cost.
8. Calendar: 7 days filled; each post shows its Creative Director score and any flagged claims.
9. Open a post: 6 platform variants, each at the right size; carousels show all slides; video variants say "Storyboard — video not rendered" and show hook, script and shots with Veo/Kling prompts.
10. Edit one caption (add "ISO 9001 certified"). A new version is created, the claim is flagged, the image re-renders, the old version stays viewable.
11. Regenerate one image with an instruction, then one copy. Each creates a new version.
12. Grid preview: the next posts as an Instagram profile, newest top-left.
13. Approve all 7 posts (per post or "approve all ready posts without flagged claims" then the flagged one by hand).
14. Export: the 7 days. Download the ZIP. Check folders `<date>/<platform>/`, slides numbered in order, `storyboard.md` for videos, `caption.txt`, and that `metricool_bulk_upload.csv` and `posts_generic.csv` open in Excel or Google Sheets with accents intact.
15. Usage page: AI runs and images are listed per brand with cost.

## B. Real brand (needs the brand pack and the API key)

1. Put the pack in `brand-packs/<folder>/` (layout in `brand-packs/README.md`).
2. `docker compose exec web npx tsx scripts/import-brand-pack.ts brand-packs/<folder> "Brand name" --languages=id,en`
3. Wait for the ingestion jobs; review every proposal against the source. Nothing invented should appear; fill missing sections by hand.
4. Repeat A5–A14 on this brand. Check that every fact in captions is in the Brand Brain, and that prices marked not public never appear.

## C. Robustness

1. Restart: `docker compose down && docker compose up -d`. Every brand, plan, post, version and image is still there.
2. Two brands: open brand A's post URL with brand B's id in the path: "Not found". Search brand B's Brand Brain, posts and export for brand A's product names: none.
3. Worker crash: start a 7-day batch, then `docker compose kill worker` while it runs, then `docker compose up -d worker`. The batch finishes; the calendar has exactly one post per plan item.
4. No image key: remove FAL_KEY, restart. Produce page shows the image provider setup state; new images render on brand photos or brand colour and say so.
5. No AI key: set AI_PROVIDER=anthropic with an empty ANTHROPIC_API_KEY, restart. Brand Brain upload, plan and produce show the AI setup state; nothing pretends to succeed.
6. Invalid upload: upload a `.exe` and a text file renamed to `.pdf`. Both are refused with a clear message.
7. AI error: with a deliberately wrong ANTHROPIC_API_KEY, run a plan. The job fails with the API error shown on the Jobs page and logged under "Latest AI runs".
