# NOVRA — instructions for Claude

NOVRA is a personal AI social media content agency tool for one operator serving several brands.

At the start of every session:

1. Read `docs/SPEC.md` (the Milestone 1 spec — source of truth).
2. Read `docs/STATUS.md` to see which build step is next.
3. Read `docs/DECISIONS.md` for assumptions already made.

Then continue with the next unfinished build step in SPEC.md section 8. After each step: run the tests, update `docs/STATUS.md`, and commit with a clear message.

Never commit secrets. API keys live only in `.env` (not committed). Brand material in `brand-packs/` is confidential client data: use it only for that brand.
