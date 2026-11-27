# Trip Passport — notes for Claude

Satish's personal travel app. Live at https://director176.github.io/trip-passport/ (GitHub Pages, `main` branch, repo root). Backend: Supabase.

## Files
- `index.html` — the whole app (UI + JS). `adapter.js` exposes `window.claude.use("db")` backed by Supabase, with an offline cache.
- `config.js` — Supabase URL + **publishable** key only. Never commit a service_role/secret key or the Anthropic key.
- `sw.js` — service worker. **Bump the cache version (`tp-vN`) on every release** or phones keep the old app.
- `world.json` — world map, Equal Earth projection ×100 (y negated), ISO2 codes. Same `proj()` as in index.html.
- `supabase/functions/parse-plan/index.ts` — Edge Function that reads travel plans with Claude. Uses the `ANTHROPIC_API_KEY` Supabase secret. Deployed by hand in Supabase; editing it here does not deploy it.

## Data paths (table `public.docs`)
`trips/{tid}`, `t/{tid}/expenses|exchanges|checks/*`, `t/{tid}/settings/trip|wallet|cards|prep`, `atlas/wish`, `atlas/seals`, `settings/people`.

## Rules
- Satish uses a foldable iPhone (Duo): test folded (~466×678) and unfolded (~890×626), plus a normal phone (390×844).
- Every feature must be richly styled in the passport theme (stamps, seals, tickets, pull-up sheets). Never a plain list.
- No feature bloat; reliability first. Find and fix bugs before shipping.
- Sanchi is his wife; he pays for everything. No "who paid / owes" features.
- Never store passport numbers, DOBs or ID numbers.
- Ship changes on a branch + PR for Satish to approve. Do not push to `main` without his OK.
