# Development setup

## Prerequisites

- **Node 20 LTS** — a safe default for a Vite 6 project; match it locally. Newer Node works for the
  build but produces npm compatibility warnings.
- **npm 9+**.
- A **Supabase project** (or the Supabase CLI for a local one).

There is no `.nvmrc` / `.tool-versions` in the repo. Adding one is a two-line fix that removes a
whole class of "works on my machine" — see [contributing](./08-contributing.md).

## First run

```bash
git clone <repo> && cd YULMixLaBedaine
npm install                 # NOT npm ci — see below
cp .env.example .env        # then fill in the two VITE_ values
npm run dev                 # http://localhost:5173
```

`src/lib/supabase.js` throws at import time if either variable is missing, so a bad `.env` fails
immediately and loudly rather than at the first query.

> ⚠️ **`npm ci` currently fails**: `package-lock.json` is out of sync with `package.json`
> (`@testing-library/dom` and its transitive deps are missing from the lock). Verified locally:
> `npm ci` exits with *"can only install packages when your package.json and package-lock.json are
> in sync"*. Run `npm install` once, commit the updated lockfile, and `npm ci` — and therefore CI —
> becomes usable.

## Supabase setup

1. Create a project; copy the URL and anon key into `.env`.
2. Enable the **Google** and **Facebook** providers, and register the redirect URLs
   (`http://localhost:5173` and the production origin) under
   *Authentication → URL Configuration*.
3. Apply the schema from `supabase/migrations/`. For a local database, `supabase start` applies
   every migration. For a new hosted project, link it and push:
   `supabase link --project-ref <ref>`, then `supabase db push`.

## Database migrations

The schema lives in `supabase/migrations/` ([ADR 0013](./adr/0013-supabase-migrations.md)). The
first file, `20260924233313_baseline_live_schema.sql`, is a dump of production as of
2026-09-24. Every later file is one reviewed change. Nothing else in `supabase/` is applied by
the CLI. `supabase/legacy/` holds the hand-run SQL snippets from before migrations, kept only as
history.

### Changing the schema

```bash
supabase migration new add_something        # creates supabase/migrations/<timestamp>_add_something.sql
# write the SQL (ALTER TABLE…, CREATE OR REPLACE FUNCTION…, new policies, GRANTs)
supabase db reset                           # local: rebuild from all migrations, fails loudly on bad SQL
```

- **Never edit a migration that has been applied to production.** Fix it with a new one.
- **New tables need explicit `GRANT`s** for `anon`/`authenticated`. New tables are not exposed to
  the Data API automatically (see `auto_expose_new_tables` in `supabase/config.toml`), and
  production's baseline grants only what it needs.
- If you changed the local database interactively (Studio, `psql`), `supabase db diff -f <name>`
  writes the difference to a new migration. Read the output before committing it.

CI (`.github/workflows/deploy.yml`, job *Migrations apply cleanly*) starts an empty local database
and applies every migration on each PR. A migration that doesn't parse, or depends on something
that doesn't exist, fails there before review.

### Applying to production

Production is **not** migrated by CI. After a PR with a migration merges, someone with access to
the Supabase project applies it from an up-to-date `main`:

```bash
git switch main && git pull
supabase link --project-ref ceacurlofmasyvhsoska   # once per machine
supabase migration list --linked                   # what production has vs. what's in the repo
supabase db push --linked --dry-run                # shows which files would run; runs nothing
supabase db push --linked                          # applies them, records them in production's history
```

Then check the app as both a member and an admin.

**One-time step before the first push.** Before migrations were adopted, production had no
migration history table. It already contains everything in the baseline, so tell it so, once:

```bash
supabase migration repair --status applied 20260924233313 --linked
```

Without this, `db push` tries to run the baseline against production and fails on objects that
already exist. `migration list --linked` should then show the baseline as applied on both sides.
This writes only to `supabase_migrations.schema_migrations` and changes no app table.

**Do not** use `supabase db query --linked` or the SQL editor to change production's schema. It
creates exactly the drift ADR 0013 exists to stop. `db query` is still fine for read-only
`SELECT`s.

## Scripts

| Command | What it does | Verified state (2026-09-17) |
|---|---|---|
| `npm run dev` | Vite dev server on :5173 | — |
| `npm run build` | Production build to `dist/` | ✅ passes, ~1.3s, 1943 modules |
| `npm run preview` | Serve the built `dist/` | — |
| `npm run test:pricing` | Jest, `pricingEngine.test.js` only | ✅ 5/5 cases pass |
| `npm test` | Jest, default (unit) suite | ✅ passes — excludes the RLS integration suite, see below |
| `npm run test:rls` | Jest, RLS suite only, `--config jest.rls.config.js` | needs a local Supabase instance; fails on `ECONNREFUSED` without one (not on a jsdom artifact — see below) |

Build output, for reference — code splitting is configured in `vite.config.js` so Supabase, the
router and Lucide are separate chunks:

```
dist/assets/index-*.css      29.53 kB │ gzip:  6.06 kB
dist/assets/lucide-*.js       5.17 kB │ gzip:  1.74 kB
dist/assets/router-*.js      51.07 kB │ gzip: 17.96 kB
dist/assets/supabase-*.js   227.02 kB │ gzip: 58.86 kB
dist/assets/index-*.js      322.16 kB │ gzip: 92.00 kB
```

The build succeeds **without** a `.env` file, because the env check is a runtime throw rather than a
build-time one. Do not read a green build as "the app is configured".

## Testing

Two suites exist, deliberately kept on separate tracks: a unit suite that needs nothing but Node,
and an integration suite that needs a live Supabase instance. `npm test` only runs the former, so
CI can be green without any external infrastructure.

### `src/lib/pricingEngine.test.js` — the unit suite

Five Jest `test()` cases covering the edge cases from the requirements: zero points, a single
adult, the new-member discount, fractional selling prices, and grandfathering a paid party. Run it
on its own with `npm run test:pricing`, or as part of `npm test`. It is the only meaningful
coverage in the repo, and it is genuinely pure — no Supabase, no DOM, no I/O.

### `src/__tests__/rlsPolicies.test.js` — the RLS integration suite

The most valuable *kind* of test in the repo (see [security](./06-security-and-rls.md#testing-rls))
but the most expensive to run: it drives a real local Supabase instance with both an anon and a
service-role client, asserting members cannot see DRAFT events, cannot read others' registrations,
and so on.

It is excluded from `npm test` via `jest.config.js`'s `testPathIgnorePatterns` and run separately
with `npm run test:rls`, which points Jest at `jest.rls.config.js` (identical to the default config
minus that exclusion). The file itself carries an `@jest-environment node` docblock pragma, so it
gets Node's native `fetch` — jsdom, the project's default test environment, does not provide one,
and without the pragma every request used to fail with `ReferenceError: fetch is not defined`
regardless of whether Supabase was even reachable.

#### Running the RLS tests

With the environment issue fixed, `npm run test:rls` fails cleanly on `ECONNREFUSED` in this repo
today — the honest failure, because no Supabase instance is running here. To make it actually pass:

1. A local Supabase: `supabase start`. It uses the committed `supabase/config.toml` and applies
   `supabase/migrations/`, so the local schema matches production's.
2. `.env.test` with a real local service-role key (and that file should be gitignored, see
   [security](./06-security-and-rls.md#secrets)).
3. Seed data: `supabase/tests/seed_test_data.sql` defines a `seed_test_data()` function the suite
   calls, falling back to inline seeding.

`supabase/tests/README.md` documents the intended workflow, in PowerShell — the project was
developed on Windows. The commands are shell-agnostic enough to translate.

## Environment files

| File | Tracked | Purpose |
|---|---|---|
| `.env.example` | yes | template for `.env` |
| `.env` | no (gitignored) | your local Supabase credentials |
| `.env.test.example` | yes | template for `.env.test` |
| `.env.test` | **yes — should not be** | placeholders only today; gitignore it before someone adds a real key |

## Deploying

**Production runs on Vercel.** `vercel.json` sets the build command, `dist` output, and the SPA
rewrite; set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel project settings.

`netlify.toml` is leftover config from before the host was settled — it is not in use and should
be deleted (see [issue #45](https://github.com/YULmix/yulmix-la-bedaine/issues/45)).

**Vercel's own git integration is currently disconnected** — the project is still linked to the
repo's pre-transfer identity (`Dekayd/YULMixLaBedaine`), and reconnecting it needs a `YULmix` org
owner. See [Live environment audit](./11-live-environment.md#deployment) for how that was found.

Until that's reconnected, `.github/workflows/deploy.yml` deploys straight from CI using the Vercel
CLI: on every push and PR it runs `npm run build` and `npm run test:pricing`; on push to `main` it
also runs `vercel pull` / `vercel build` / `vercel deploy --prebuilt --prod`. This is the CI gate
that used to be missing, whichever way the Git integration ends up.

It needs three repo secrets, set once by someone with access to the `yulm-ix` Vercel account:

| Secret | Value |
|---|---|
| `VERCEL_TOKEN` | a personal token from `vercel.com/account/tokens` |
| `VERCEL_ORG_ID` | `team_2Dq8V0ST1KNITgzIndZyh3IX` |
| `VERCEL_PROJECT_ID` | `prj_hAUPlcsCKxYEW6URcw08AuyE8G8J` |

Set them with `gh secret set <name>`, typed or pasted directly into that command — never handed to
an AI assistant, since that would force rotating them. The workflow pulls the app's own
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from the Vercel project itself, so nothing
Supabase-related needs to be duplicated here.

After changing the Supabase project or the production domain, re-check the OAuth redirect URLs —
a mismatch there is the classic "sign-in loops back to the home page signed out" symptom.

## Agent tooling in this repo

- **`.clinerules`** — the rules David's agent (Cline) worked under. Two thirds of it is genuinely
  useful project convention (stack, localisation, encoding, schema-change protocol); the last third
  hardcodes **Windows PowerShell 5.1** shell rules that are wrong on macOS/Linux. Split it: project
  conventions belong in a shared `AGENTS.md` / `CLAUDE.md`, shell specifics belong in each
  developer's own config.
- Individual contributors may have their own local agent skill installs (e.g. under `.agents/` or
  `.claude/`) — these are personal tooling, gitignored, and not part of the project's conventions.
