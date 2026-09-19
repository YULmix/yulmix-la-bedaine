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
3. Apply the schema: paste `supabase/schema.sql` into the SQL editor.

> ⚠️ **`supabase/schema.sql` does not currently execute as a whole.** The
> `admin_set_is_admin` function is opened with `AS $` instead of a valid dollar-quote tag
> (`AS $$`) and is never closed, so Postgres will not parse from that point on. The live database
> evidently has a working version of the function — the admin toggle calls it — so the *file* is
> what is broken, not production. Fix the quoting before relying on the file for a fresh
> environment, and see [ADR 0002](./adr/0002-single-schema-file-no-migrations.md) for why this went
> unnoticed.

Also note the file uses bare `CREATE TABLE` / `CREATE POLICY` without `IF NOT EXISTS` for most
objects, so it is **not** idempotent: re-running it against a populated database errors out. Treat it
as "how to build a fresh database", and apply changes to an existing one with hand-written `ALTER`
snippets (which `.clinerules` already requires you to produce alongside any schema edit).

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

1. A local Supabase: `supabase start`, then apply the schema. Note there is **no
   `supabase/config.toml`** in the repo, so `supabase start` has nothing to configure from —
   `supabase init` output should be committed.
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
be deleted (see [state of the code](./09-state-of-the-code.md)).

Deploys today are triggered manually / by Vercel's own git integration, with no build or test gate
in front of them. **Wiring the deploy into CI** — so a push to `main` only reaches production after
`npm run build` and `npm test` pass — is a Stage 0 item; see
[roadmap](./10-roadmap.md#stage-0--make-the-repo-collaborable).

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
