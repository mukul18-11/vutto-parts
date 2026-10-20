# Vutto Parts

Spare parts inventory for Vutto's two-wheeler refurbishment workshops (Delhi NCR and Jaipur):
purchase orders, goods receipt, putaway, reservations and issue of parts to each bike's job card.
The specification is [docs/SPEC.md](docs/SPEC.md).

Stack: Next.js (App Router, TypeScript), Tailwind + shadcn/ui, Supabase (Postgres, Auth, RLS,
Storage), Vitest, Playwright. Hosted on Vercel (bom1) with Supabase in ap-south-1.

## Run locally

Prerequisites: Node 24, pnpm 10, Docker (running).

```sh
pnpm install
pnpm seed:gen              # writes supabase/seed/template.sql (before the first supabase start)
pnpm supabase start        # local Supabase on http://127.0.0.1:54321 (Studio on :54323)
cp .env.example .env       # then fill the keys from: pnpm supabase status -o env
pnpm demo:users            # creates the 5 demo logins (again after every supabase db reset)
pnpm dev                   # http://localhost:3000
```

`pnpm seed:gen` and `pnpm demo:users` arrive with the seed and auth work; until then, skip them.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test        # unit tests (run in TZ=America/Los_Angeles on purpose)
pnpm test:db     # integration tests against local Supabase
pnpm test:e2e    # Playwright, against a production build and local Supabase
pnpm types       # regenerate src/lib/database.types.ts after a schema change
```

## Deploying

Pushing to `main` deploys: Vercel builds the app, and the Supabase GitHub integration applies new
migrations to production. Never run `supabase db push`. See CLAUDE.md for the rules.
