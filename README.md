# Aglotrends

> Status: **running locally** — the full monorepo is built (engine, database,
> API, web), the `aglotrends` database is created and seeded, and the
> registration → payment → activation → compensation flow is verified end-to-end
> by a live smoke test. Not deployed; not yet pushed to a remote.

Aglotrends is a four-pillar trading platform — **Copy Trading · Signal Service ·
Referral/Network · Trader Community** — bound together by a single compensation engine.

Two decisions shape the whole build:

- **Copying is manual.** The copy is placed on the client's own broker account.
  Aglotrends links to partner brokers and records the account; it never places trades.
- **Signals are manual.** An admin authors a signal in the backend; members see it on
  the dashboard and receive it on whichever channels they enabled (email / WhatsApp /
  Telegram).

Because copying is manual there is no live P&L feed, so the 60/10/30 profit split is
driven by an **admin-entered realized profit per client per period**. See
`docs/CONCEPT.md` §4.

## Repository layout

```
Aglotrends/
  packages/engine/        pure-TS compensation engine (integer cents, bps, no deps)
  database/               Drizzle schema (20 tables), migrations, seeds
  apps/api/               Express 4 + JWT + zod API
  apps/web/               Next 15 + React 19 + Tailwind 4 (marketing + portal + admin)
  docs/                   CONCEPT.md, COMPENSATION_PLAN.md (+ HTML/PDF)
  infrastructure/         provision-db.ps1
```

## Prerequisites

- Node >= 20, pnpm 11
- PostgreSQL 16 (the dev instance listens on **port 5433**, not 5432)

## Getting started

```powershell
pnpm install
```

**1. Create the database.** The app role (`aglotrends`) has no CREATEDB, so this needs a
superuser once:

```powershell
# as the postgres superuser
$env:PGPASSWORD = "<superuser password>"
.\infrastructure\provision-db.ps1
# or, by hand:
#   CREATE DATABASE aglotrends OWNER aglotrends;
#   CREATE DATABASE aglotrends_test OWNER aglotrends;
```

**2. Configure env.** Copy the examples and fill them in:

```powershell
Copy-Item database\.env.example database\.env
Copy-Item apps\api\.env.example apps\api\.env
Copy-Item apps\web\.env.example apps\web\.env
```

`DATABASE_URL` must point at the `aglotrends` database on port **5433**.
Set a real `JWT_SECRET` before anything leaves your machine.

**3. Migrate and seed.**

```powershell
pnpm db:migrate
pnpm db:seed-users   # idempotent fixtures (see below)
pnpm db:seed         # optional: fuller demo data
```

**4. Run.**

```powershell
pnpm dev:api   # http://localhost:4000  (GET /health)
pnpm dev:web   # http://localhost:3000  (proxies /api/* to :4000)
```

## Dev fixtures

Seeded logins are **not** in the repository. `pnpm db:seed-users` reads them from
`database/seed.accounts.json` (gitignored) and prints the truth from the database.
Start from the committed template:

```powershell
Copy-Item database\seed.accounts.example.json database\seed.accounts.json
# edit seed.accounts.json with your real dev emails + passwords
```

With no `seed.accounts.json` present the seed falls back to the committed
`seed.accounts.example.json` and seeds **placeholder** accounts (`@example.com` /
`CHANGE_ME_*`), so a fresh clone still runs with no credentials in git.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every package |
| `pnpm test` | Run every package's tests (engine 58 + api 30 = 88) |
| `pnpm lint` | Typecheck every package |
| `pnpm dev:api` / `pnpm dev:web` | Run the API / web in dev |
| `pnpm db:generate` | Generate a migration from the schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` / `db:seed-users` | Seed demo data / repair fixtures |

## Architecture notes

- **Money is integer cents everywhere**, matching `@aglotrends/engine`. Rates are basis
  points; splits use largest-remainder rounding so the parts always sum to the whole.
- **The engine is pure** — no framework, no DB. It is the single source of truth for the
  compensation plan; the API calls it, the DB stores its output.
- **No `ON DELETE CASCADE`** anywhere: a member is never deleted out from under their
  ledger. Cleanup tooling must respect the order.
- **Sessions travel two ways**: `Authorization: Bearer` for scripts/mobile, and an
  httpOnly cookie (`aglotrends_session`) for the web app, so JavaScript never holds the
  token. The web app proxies `/api/*` to the API (same-origin → no CORS, cookie rides along).
- **Unconfigured notification channels record `SKIPPED`, never `FAILED`** — a missing
  provider must not look like a delivery error.

## Read this before go-live

The compensation plan is **recruitment-funded** (55% of every registration fee is paid
back out as network bonuses). Its lawfulness is a jurisdiction question, not an
engineering one. `docs/CONCEPT.md` → *Risk map* lists what must be resolved first —
**regulatory classification is blocking**. Confirm with counsel before go-live. The UI
must never imply fixed or guaranteed returns.
