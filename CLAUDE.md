# Vutto spare parts system: rules for Claude Code

You are building a production-grade spare parts inventory system for Vutto's two-wheeler refurbishment workshops. Reviewers will use the live app with test logins, on laptops and phones. Correctness of stock numbers matters more than features.

## Source of truth
- docs/SPEC.md is the specification. Follow it exactly. If something is missing or contradictory, stop and ask; do not invent behaviour.
- When a prompt says "SPEC §N", re-read that section before writing code.

## Stack (do not change)
- Next.js App Router, TypeScript strict, pnpm. Tailwind + shadcn/ui. Zod for every input.
- Supabase: Postgres, Auth (email + password), Row Level Security, Storage. Supabase CLI for local dev and migrations.
- Vitest (unit + DB integration against local Supabase), Playwright (one e2e flow), GitHub Actions CI. Vercel hosting.

## Non-negotiable rules
1. Every write to workshop data goes through a Postgres RPC (SECURITY DEFINER) that follows SPEC §11. The browser and server code never INSERT/UPDATE/DELETE workshop tables directly. Exception: the master data tables listed in SPEC §11.2 are edited directly under RLS (admin; reorder_settings also by that workshop's manager).
2. Stock changes only by inserting into stock_moves. stock_balances is maintained only by the ledger trigger. Nothing else writes it, except the demo reset's one-aggregate rebuild in SPEC §15 (and the TRUNCATE in reset_demo and test_clear).
3. Money is integer paise (bigint) everywhere. Never use floats for money. Parse rupee strings with the shared parser.
4. All "day" logic uses Asia/Kolkata via the SQL helpers private.ist_date() / private.ist_today() and src/lib/time.ts. Never call new Date('YYYY-MM-DD'). Date-only values are 'YYYY-MM-DD' strings.
5. RPC failures RAISE a stable UPPER_SNAKE error code (SPEC §11.4). Server actions never throw for expected failures; they return { ok: false, code, message }.
6. Migrations already applied are immutable. Changes go in a new migration, always created with `supabase migration new <name>` (timestamped names; never hand-numbered files). A function signature change = DROP FUNCTION old signature, then CREATE. No overloaded function names in public. Every migration that creates or re-creates a function ends with REVOKE EXECUTE … FROM PUBLIC, anon and the GRANT EXECUTE that SPEC §11.2 allows; every new view or table gets GRANT SELECT … TO authenticated. Add every new public function to tests/db/rpc-allowlist.json. Trigger functions and helpers live in schema private, never public.
7. No caching of user data: authenticated pages are dynamic; no 'use cache', unstable_cache, PPR or service worker.
8. Never put the Supabase service_role key in Vercel or in any NEXT_PUBLIC_ variable.
9. Never weaken, skip or delete a test to make it pass. Fix the code.
10. Keep it simple. Build what the spec says; no extra features, no extra libraries without asking.
11. Tests run only against local Supabase (every test helper calls assertLocal()). Production values live only in .env.prod.local; never read it in tests or app code.
12. If a screen needs read SQL that does not exist yet (ranked candidates, tile counts, a list view), add a SECURITY INVOKER view or function in a new migration, with grants and an allowlist entry, and say so in your summary.

## Commands
- pnpm dev | pnpm build | pnpm lint | pnpm typecheck
- pnpm test (unit) | pnpm test:db (integration, needs `supabase start`) | pnpm test:e2e
- pnpm supabase start | pnpm supabase db reset | pnpm types (= supabase gen types typescript --local > src/lib/database.types.ts). The Supabase CLI is the pinned devDependency; there is no global install, so always call it as `pnpm supabase …`.
- pnpm seed:gen (writes the demo dataset) | pnpm demo:users (creates the 5 demo logins)
- After a fresh clone: pnpm seed:gen before pnpm supabase start. After every local pnpm supabase db reset: pnpm demo:users (a reset wipes auth users).

## Deploying migrations (Supabase GitHub integration)
The production Supabase project is connected to the GitHub repo (production branch `main`). Every push to `main` makes Supabase apply any new files in supabase/migrations to the production database, and Vercel deploys the same commit. This replaces the `supabase db push` step in SPEC §16: where SPEC §16 says migrations reach production via `supabase db push`, follow this section instead.
- "Deploy to production" is enabled in the Supabase dashboard (Settings → Integrations → GitHub). Prompts written earlier may tell you to run `supabase db push` (or to "push migrations to production"): skip that step. Committing on `main` replaces it, because the integration deploys on push. Say in your summary that the step was replaced. If you have reason to think the toggle is off, ask the user to check that page; never push migrations yourself.
- Never run `supabase db push`, `supabase db reset --linked`, `supabase migration repair` or anything else that writes to the production database, and never change the production schema in the dashboard SQL editor. The GitHub integration is the only path to production; a second path would apply and record migrations out of step with it.
- The production deploy runs each migration in one transaction, so a migration must not use anything that cannot run inside a transaction (CREATE INDEX CONCURRENTLY, VACUUM, ALTER SYSTEM). The CLI accepts these locally; the GitHub deploy fails on them.
- Never add a `[remotes]` block for the production project to supabase/config.toml: it would push local auth and db settings (signups, rate limits, site_url) to production. Never declare storage buckets or Edge Functions in config.toml either; the integration deploys those to production. Buckets are created in migrations.
- A post-commit hook pushes every commit to GitHub, so a commit on `main` is a production deploy. Before committing a migration on `main`: supabase db reset, pnpm demo:users, then everything in the definition of done passes. Unfinished migrations stay uncommitted or on a branch other than `main` (other branches never reach production).
- A migration committed on `main` is applied in production, so it is immutable from then on (rule 6). Fix mistakes with a new migration.
- Supabase and Vercel deploy in parallel, so new code can briefly run against the old schema. After pushing a migration, check that /api/health reports the new migration version. If it does not, or the Supabase deploy failed, stop and tell the user; do not try to fix production by hand.

## Definition of done for every task
- pnpm lint, pnpm typecheck, pnpm test, pnpm test:db all pass.
- Database types regenerated if the schema changed.
- New behaviour has tests, including the edge cases listed in the prompt.
- Short summary of what changed and anything left undone.

