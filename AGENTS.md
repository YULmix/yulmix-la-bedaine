# Working on La Bédaine

This file is the entry point for any agent (or human) about to make a change here. It tells you
where to find things — the actual conventions, architecture, and business rules live in `docs/`,
not in this file. Read this first, then follow the pointers.

## Start here

1. **[`docs/README.md`](./docs/README.md)** — the documentation index. Read it before touching
   anything non-trivial.
2. **[GitHub Issues](https://github.com/YULmix/yulmix-la-bedaine/issues)** — the only source of truth
   for known defects, planned work, and open questions needing an organiser decision. Check open
   issues before "discovering" a bug that's already tracked, and before assuming something odd in the
   code is a mistake rather than a deliberate (if undocumented) choice explained in an ADR. There is
   no defect list or roadmap file in `docs/` anymore — don't recreate one; file an issue instead.
3. **[`docs/glossary.md`](./docs/glossary.md)** — the domain vocabulary (party, tier, point, selling
   price vs. base cost…). Get this right before writing code or docs that use these terms.

If you only read three docs beyond this file, make them
[Architecture](./docs/02-architecture.md), [Data model](./docs/03-data-model.md), and
[Pricing & business rules](./docs/04-pricing-and-business-rules.md) — together they explain the
shape of the system and the one calculation that has to be right.

## The rules that actually matter

Full detail in [Contributing](./docs/08-contributing.md); the ones most likely to bite:

- **The database is the authority, not the browser.** This is a Supabase-only app — no backend of
  our own (see [ADR 0001](./docs/adr/0001-supabase-as-the-only-backend.md)). Any rule that must
  hold (money, access, capacity) has to live in Postgres as a constraint, trigger, RLS policy, or
  `SECURITY DEFINER` function. A check in React is a convenience, not enforcement.
- **French for users, English for code.** Every UI string goes in `src/locales/fr.json`; every
  identifier, column, and filename is English. Never render a raw database value — map it through
  `src/lib/registrationOptions.js`.
- **Schema changes are migrations, never hand-run SQL.** Add a file with
  `supabase migration new <name>` under `supabase/migrations/`; it's reviewed in the PR and CI
  applies it to production on merge, after a backup
  ([ADR 0014](./docs/adr/0014-ci-applies-migrations-on-merge.md)). Don't run `supabase db push`
  yourself, and fix a bad migration with a new one (no down-migrations). Do not change production with
  `supabase db query --linked` or the SQL editor (read-only `SELECT`s are fine), and never edit
  the baseline or any already-applied migration. `supabase/legacy/` is history, not a template.
- **Pricing changes come with a test.** `src/lib/pricingEngine.js` is pure; add a case to
  `src/lib/pricingEngine.test.js` for any rule change and run `npm run test:pricing`.
- **UTF-8, no BOM.** Several tracked files already have one; don't add more.

## Work tracking

Work in progress and work to be done belongs in **GitHub Issues** (or beads tasks, if adopted) —
not in `docs/Bedaine App - Requirements.md`. That file is a historical record of the original
prompt-by-prompt spec, kept for context; it is not a TODO list, and appending to it is how it
became hard to use. See [Contributing → Tracking work](./docs/08-contributing.md#tracking-work).

### Procedure: picking up an issue

Before starting work on a GitHub issue (e.g. "tackle the next highest issue"), assign it to the
requesting user (`gh issue edit <number> --add-assignee <github-login>`) so it's visibly claimed
before any commits or a PR show up.

When the PR for that issue is opened, explicitly assign it too
(`gh pr create --assignee <github-login> ...`, or `gh pr edit <number> --add-assignee <github-login>`
right after). Don't rely on the PR ending up assigned some other way (an org default, a repo
automation) even if it happens to work — assign it yourself so it's not an accident.

### Procedure: never commit to `main`

Always work on a feature branch, even for a small or unrelated-looking change (e.g. an AGENTS.md
edit picked up mid-task). `main` is protected and rejects direct pushes anyway, but branch first —
don't find that out by pushing to `main` and having to redo the commit on a branch. A doc or
process fix discovered while working an issue belongs in the same branch/PR as that issue unless
it's unrelated enough to need its own.

### Procedure: don't delete a branch tied to an open PR

Never delete a local or remote branch that has an open, unmerged PR on it, even after copying its
commits elsewhere (e.g. cherry-picking onto the branch you should have used) — ask first. It
leaves the PR without a branch to keep iterating on, and "the commits are safe on the remote" is
not the same as leaving the person's working state alone.

### Procedure: verify acceptance criteria, don't assume them

Before calling an issue fixed, actually exercise the behavior the issue describes — not just
`npm run build` / a green CI syntax check. For a DB change that means applying the migration to a
real Postgres (`supabase start` locally, or a preview branch) and running the actual scenario:
insert rows that should trip a trigger or constraint, run a query or update as the affected role
(`set role authenticated; select set_config('request.jwt.claims', ...)`) to prove an RLS policy
now allows or blocks what it's supposed to, or drive it through a real browser with
`npm run test:e2e` (see [Development setup](./docs/07-development-setup.md#scripts)) against the
seeded `member@test.local` / `admin@test.local` users — the concrete mechanism for the "exercise
the change as both a member and an admin" rule below, not just an aspiration. If docker is unavailable in the session but the user's
account is already in the `docker` group (`getent group docker`), the shell just started before
that took effect — use `newgrp docker <<'EOF' ... EOF` rather than reporting the environment as
broken or asking the user to "grant access" again. Passing CI's syntax/lint checks is necessary,
not sufficient — say explicitly what was and wasn't verified rather than presenting a build pass
as proof the acceptance criteria are met.

## Verifying your work

- `npm run build` — must pass.
- `npm run test:pricing` — must pass; add cases for pricing changes.
- `npm test` — must pass (the RLS suite is deliberately excluded; see
  [Development setup](./docs/07-development-setup.md#scripts)).
- Exercise the change as **both** a member and an admin — RLS means the two roles genuinely see
  different things, and that boundary is the one most likely to break silently. `npm run test:e2e`
  (Playwright, against a local Supabase and the seeded test users) is how to actually do this in a
  real browser rather than asserting it by reading the code — see
  [Development setup](./docs/07-development-setup.md#scripts).

## Deployment

Production runs on **Vercel** (`vercel.json`). `netlify.toml` is dead config, kept only until
someone deletes it — do not treat it as a second deploy target.
