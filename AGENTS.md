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

## Verifying your work

- `npm run build` — must pass.
- `npm run test:pricing` — must pass; add cases for pricing changes.
- `npm test` — must pass (the RLS suite is deliberately excluded; see
  [Development setup](./docs/07-development-setup.md#scripts)).
- Exercise the change as **both** a member and an admin — RLS means the two roles genuinely see
  different things, and that boundary is the one most likely to break silently.

## Deployment

Production runs on **Vercel** (`vercel.json`). `netlify.toml` is dead config, kept only until
someone deletes it — do not treat it as a second deploy target.
