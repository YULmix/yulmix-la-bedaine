# Working on La Bédaine

This file is the entry point for any agent (or human) about to make a change here. It tells you
where to find things — the actual conventions, architecture, and business rules live in `docs/`,
not in this file. Read this first, then follow the pointers.

## Start here

1. **[`docs/README.md`](./docs/README.md)** — the documentation index. Read it before touching
   anything non-trivial.
2. **[`docs/09-state-of-the-code.md`](./docs/09-state-of-the-code.md)** — known defects and gaps,
   each cited to `file:line`. Check this before "discovering" a bug that's already tracked, and
   before assuming something odd in the code is a mistake rather than a deliberate (if undocumented)
   choice explained in an ADR.
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
- **Touch `supabase/schema.sql` → ship an `ALTER` snippet.** There are no migrations yet
  ([ADR 0002](./docs/adr/0002-single-schema-file-no-migrations.md)), so any schema change needs the
  isolated delta statements alongside it, or the file and the live database will drift further than
  they already have.
- **Pricing changes come with a test.** `src/lib/pricingEngine.js` is pure; add a case to
  `src/lib/pricingEngine.test.js` for any rule change and run `npm run test:pricing`.
- **UTF-8, no BOM.** Several tracked files already have one; don't add more.

## Work tracking

Work in progress and work to be done belongs in **GitHub Issues** (or beads tasks, if adopted) —
not in `docs/Bedaine App - Requirements.md`. That file is a historical record of the original
prompt-by-prompt spec, kept for context; it is not a TODO list, and appending to it is how it
became hard to use. See [Contributing → Tracking work](./docs/08-contributing.md#tracking-work).

## Verifying your work

- `npm run build` — must pass.
- `npm run test:pricing` — must pass; add cases for pricing changes.
- `npm test` — currently broken (two of three suites fail); see
  [Development setup](./docs/07-development-setup.md#scripts) before trusting its output either way.
- Exercise the change as **both** a member and an admin — RLS means the two roles genuinely see
  different things, and that boundary is the one most likely to break silently.

## Deployment

Production runs on **Vercel** (`vercel.json`). `netlify.toml` is dead config, kept only until
someone deletes it — do not treat it as a second deploy target.
