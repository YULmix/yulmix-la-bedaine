# Contributing

The goal of this document is to take the project from "David and an agent in one working tree" to
"several friends can safely change things at once" — without adding ceremony that a volunteer
project will not sustain.

## Ground rules

1. **French for users, English for code.** Every UI string in `src/locales/fr.json`; every
   identifier, column, filename and comment in English.
2. **The database is the authority.** Any rule that must hold — money, access, capacity — belongs in
   Postgres. A check in React is a convenience.
3. **Never render a raw database value.** Map it through `src/lib/registrationOptions.js`.
4. **Touch `supabase/schema.sql` → ship an `ALTER` snippet.** Every schema change must include the
   isolated delta statements to run against the live database, in the PR description. Without
   migrations this is the only thing keeping file and reality aligned.
5. **Pricing changes come with a test.** `src/lib/pricingEngine.js` is pure; keep it that way, and
   add a case to its test file for any rule change.
6. **UTF-8 without BOM.** Check before committing; Windows editors add BOMs silently.

## Branching and review

- `main` is the deployable branch. Do not commit to it directly.
- Branch as `type/short-slug`: `feat/waitlist-promotion`, `fix/admin-counts-trigger`,
  `docs/architecture`, `chore/lockfile`.
- One logical change per PR. The existing history has commits like *"Admin bugfixes"* touching
  hundreds of lines across eight concerns — reviewable by nobody, including the author in six months.
- Every PR needs: what changed, why, how it was verified, and the SQL delta if the schema moved.
- Small, obvious PRs can self-merge after CI is green. Anything touching **pricing, RLS, or the
  schema** needs a second pair of eyes. Those three areas are where a mistake costs money or leaks
  personal data.

### Commit messages

Present tense, scoped, one line: `fix(admin): refresh parties after saving logistics`.
The current history (*"head assets"* ×3) is not a model to follow.

## Definition of done

- [ ] `npm run build` passes.
- [ ] `npm run test:pricing` passes (and `npm test`, once it is fixed).
- [ ] New/changed UI text is in `fr.json`, not inline.
- [ ] Schema change includes the `ALTER` delta and this repo's docs are updated.
- [ ] Manually exercised as **both** a member and an admin — the two roles see genuinely different
      screens and the RLS boundary between them is the thing most likely to break.
- [ ] No new `console.log` of session or personal data.

## Tracking work

**Work in progress and work to be done lives in GitHub Issues** (or beads tasks, if the team
adopts that tool) — not in a Markdown file. Each item in
[state of the code](./09-state-of-the-code.md) and each roadmap step is a candidate issue: file it,
assign it, close it when it's done, and let the issue carry the discussion and the eventual PR link.

`docs/Bedaine App - Requirements.md` stays in the repo as a **historical record of intent** — the
original prompt-by-prompt spec, including the decisions that were made and later reversed. It is
useful to read once, to understand why something is shaped the way it is. It is **not** where
ongoing work is tracked: it was never structured for that (no dates, no status per item, no
ownership), and treating it as a living TODO list is how it became the "mess" it is today. Don't
keep appending new work items to it — open an issue instead.

## Working with coding agents

This codebase was built mostly by prompting, and that will continue. What makes it work in a group:

- **Point the agent at the docs, not just the code.** Start from `docs/README.md`;
  `docs/09-state-of-the-code.md` lists the traps (zeroed `counts`, the broken schema file, the
  browser-computed balance) that an agent will otherwise "discover" and half-fix.
- **File agent-discovered issues in the tracker, not in a doc.** If an agent surfaces a new defect or
  gap, the output is a GitHub issue (or beads task), not another paragraph appended to a Markdown
  file — see [Tracking work](#tracking-work) above.
- **Shared rules go in a committed file; personal shell setup does not.** `.clinerules` currently
  mixes both. Project conventions (this document's ground rules) should live in a committed
  `AGENTS.md`/`CLAUDE.md`; "my shell is PowerShell 5.1" belongs in the individual's own config.
- **Verify, don't trust.** An agent will report "build passes, all tests green" because the pricing
  script exits 0 while `npm test` is red. Run the commands.
- **Small scopes.** "Fix the counts trigger and its callers" is a good task. "Refactor AdminView" is
  how you get a 1,364-line file rewritten in a way nobody can review.

## Recommended scaffolding, in priority order

None of this exists yet. It is ordered by value per hour of setup.

1. **Fix the lockfile** so `npm ci` works (`npm install`, commit). Everything below depends on it.
2. **GitHub Actions CI**: `npm ci && npm run build && npm test` on every PR. Five minutes of setup,
   and it would have caught the broken `npm test` and the out-of-sync lockfile immediately.
3. **Gate the Vercel deploy on CI**: production is deployed on Vercel today, but nothing stops a
   broken build or a failing test suite from reaching it. Deploy from CI after tests pass, not
   straight from Vercel's git integration.
4. **`.nvmrc`** pinning Node 20.
5. **ESLint** with `eslint-plugin-react-hooks`. The `fetchPartiesForActiveEvent` reference to an
   undefined function (`AdminView.jsx:403`) is a plain `no-undef` — a linter would have refused it.
   The hooks rules also catch the `useEffect` dependency patterns that cause the current re-render
   churn.
6. **Prettier**, so diffs stop containing reformatting noise. The existing files have inconsistent
   indentation mid-function.
7. **A PR template** carrying the definition-of-done checklist above, and the SQL-delta reminder.
8. **Migrations.** `supabase/migrations/` with the CLI, replacing the single append-only file. The
   most valuable item on this list and the most work — see
   [ADR 0002](./adr/0002-single-schema-file-no-migrations.md).
9. **A staging Supabase project**, so schema changes and RLS edits are not tested against the data of
   ninety friends.
10. **GitHub Issues (or beads tasks, if adopted)** as the actual work tracker — see
    [Tracking work](#tracking-work) below.

## Where things live

```
src/
  App.jsx                  routing, session, admin status, event fetch
  main.jsx                 React root + BrowserRouter
  index.css                '@import "tailwindcss";' — nothing else
  components/              reused across screens
  views/                   one per screen (plus RegistrationSummary, which is really a component)
  lib/
    supabase.js            the one client instance — never construct another
    pricingEngine.js       pure business rules + its test
    registrationOptions.js stored value ↔ French label
  locales/fr.json          every user-facing string
supabase/
  schema.sql               tables, triggers, RLS, grants (see caveats)
  tests/                   RLS seed data + intended workflow
docs/                      this documentation
```

Files that should be deleted rather than maintained: `src/App.jsx.backup`,
`src/locales/fr_broken.json`, `src/locales/fr_fixed.json`, `src/locales/fr_temp.json`,
and `netlify.toml` (production runs on Vercel; `vercel.json` is the one that matters).
