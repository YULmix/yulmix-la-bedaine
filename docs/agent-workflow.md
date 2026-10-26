# Agent Workflow Configuration

Project-specific settings for the generic `developer`, `code-reviewer`, `tester`, `scoper`, `designer`
and `supervisor` agents of the agents-dev-fleet (a private, personal toolkit). The
fleet itself is personal tooling, installed per developer under the gitignored `.claude/`
([ADR 0027](./adr/0027-central-agent-fleet-with-project-overrides.md)); this file is the shared part
that every agent reads. **Section headings are a contract with the agents; keep them stable.**

## Project docs to read

| Always | `AGENTS.md`, [`docs/README.md`](./README.md), [`docs/glossary.md`](./glossary.md), [Architecture](./02-architecture.md), [Contributing](./08-contributing.md) |
|---|---|
| Database work (migrations, RLS, functions, triggers) | [Data model](./03-data-model.md), [Security & RLS](./06-security-and-rls.md), [Development setup → Database migrations](./07-development-setup.md#database-migrations) |
| Pricing or payment | [Pricing & business rules](./04-pricing-and-business-rules.md) |
| Frontend work | [Frontend guide](./05-frontend-guide.md), its [UI checklist](./05-frontend-guide.md#ui-checklist) |
| Design decisions | [ADR index](./adr/README.md) |

Design decisions are read from these docs, the ADRs and the issues, never from a memory tool.

## Validation

Full gate, in the worktree, all must pass before an item is reported done:

```sh
npm run build && npm run typecheck && npm run lint && npm run lint:diff -- origin/main \
  && npm test && npm run test:pricing
deno test supabase/functions/ && deno check supabase/functions/*/index.ts   # when supabase/functions/ changed
```

Then, against the local database (always under the lock, see "Running the app"):

- `supabase db reset` applies the branch's migrations; a failure there is a bug to fix.
- `npm run test:rls` in full when anything under `supabase/` changed.
- `npm run db:local:demo` when the branch touches migrations, `seed.sql` or the seed generator
  ([Contributing, rule 4](./08-contributing.md#ground-rules)).
- e2e: the affected set while iterating, then **the whole suite once, in ONE invocation, on the final
  HEAD** ([Contributing → e2e verification](./08-contributing.md#e2e-verification-the-affected-set-while-iterating-the-whole-suite-before-the-pr)).
  Never a `supabase db reset` per Playwright project (30+ minutes, holds the lock for everyone). A
  failure in a spec you didn't touch: reset, rerun that project alone (`--no-deps --project=<name>`)
  to tell a real failure from leftover data. The chromium project is deliberately one worker (#170).
- Squawk on any new migration (the pre-commit hook runs it).

Narrow checks while iterating: `npx playwright test --no-deps --project=<name>`,
`npm run test:rls -- -t "<name>"`, `npm run test:e2e:affected -- --run`.

UI items: Playwright screenshots of each touched screen, as member and admin where both apply, at
390px, 1440px and (admin layout) 2560px, with realistic data, saved under
`<worktree root>/screenshots/<N>/` named screen-role-width. Look at them yourself (overflow,
horizontal scroll at 390px, clipped text) and follow the [UI checklist](./05-frontend-guide.md#ui-checklist).
**Never open a visible window on the user's desktop**: UI checks run headless.

## Worktree setup

- Worktree root: `~/code/yulmix-la-bedaine.worktrees/` beside the checkout (briefs, reports,
  supervisor ledger: the `fleet-lib.sh` defaults). Worktrees live outside the repo so `eslint .` and
  Jest in the main checkout never pick them up.
- Main checkout: `~/code/yulmix-la-bedaine`; default branch `main`; remote `origin`.
- After creating a worktree: `npm ci`, and copy the main checkout's gitignored `.env.local` and
  `.env.test` into it.
- Shared resources: **one** local Supabase stack and port 5173 (Playwright's dev server) for every
  worktree and agent. Use them only under the lock below.

## Running the app for acceptance checks

Every database command runs inside a `flock` block that starts by resetting the database from your
own worktree; nothing seen in an earlier block can be assumed in the next one (someone else may
have reset in between):

```sh
mkdir -p ~/code/yulmix-la-bedaine.worktrees
flock -w 2700 ~/code/yulmix-la-bedaine.worktrees/.localdb.lock bash -c '
  set -e
  cd <your worktree>
  if ss -ltn | grep -q ":5173 "; then echo "port 5173 busy: a dev server is running" >&2; exit 97; fi
  supabase status >/dev/null 2>&1 || supabase start
  supabase db reset
  <the tests for this block>
'
```

- Nothing but tests inside a block: no edits, no builds. Long blocks (the full e2e suite) run in the
  background. Never `npm run dev`, `supabase stop`, `supabase db query` or `npm run db:*` outside it.
- Port 5173 busy → don't kill anything, report it (Playwright would silently reuse a dev server
  serving another worktree's code). Check the port only inside the lock.
- `flock` timed out (exit 1 after 45 minutes) → do other work, retry later, mention it.
- Docker denied but `getent group docker` lists the user → run the `flock` command inside
  `newgrp docker <<'EOF' … EOF`; the environment isn't broken.
- Acceptance criteria are exercised for real, as **both** `member@test.local` and
  `admin@test.local`: SQL as each role
  (`set role authenticated; select set_config('request.jwt.claims', '{"sub":"…","role":"authenticated"}', true);`)
  or e2e. Each criterion is reported pass / fail.

## Generated code

| Trigger | Command |
|---|---|
| A migration changes the schema | `npm run db:types` (after `supabase db reset`, under the lock); commit `src/lib/database.types.ts` |
| A new e2e spec or source file | add it to `e2e/affected-map.json` (`npm test` fails until you do) |

## Tracker

Backend: `github` (GitHub Issues of `YULmix/yulmix-la-bedaine`), through `.claude/scripts/tracker.sh`
with this repo's conventions set in `.claude/fleet.env`.

- Work item = a GitHub issue; id `#n`, file-safe key `GH-n` (branches, worktrees, briefs, reports).
- **Dispatchable** = open, labelled `ready-for-agent`, not `needs-info` / `needs-triage` /
  `ready-for-human`, no open blocker, not assigned to someone else.
- States: Todo (open) → In Progress (claimed by the supervisor: label `status:in-progress`, and the
  issue is **assigned to the organiser**) → In Review (PR opened by `ship.sh`, PR assigned too) →
  Done (the PR's `Closes #n` closes it on merge).
- **Priority and Effort are GitHub's native issue fields**, not labels (`--priority`, `--effort`).
  Priority: Urgent / High / Medium / Low, the organiser's call. Effort: Low = one file or area, no
  schema; Medium = a migration or a screen with tests; High = RLS, `SECURITY DEFINER`, money, several
  areas, or a risky migration.
- Labels: one category, `bug` or `enhancement`; one state, `ready-for-agent` (an agent can start
  now), `needs-info` (waiting on the organiser; the body has a "## Questions" section with the
  default applied meanwhile) or `ready-for-human` (credentials, a purchase, a call only a human can
  make); `needs-triage` for unsorted reports; `question`. There is no `risky` label: risk is stated
  in the issue's Agent Brief. Create no other labels.
- Hierarchy and blocking: GitHub's native sub-issues and "blocked by", only for a real "can't start
  until that is merged".
- Slicing: one issue = one PR a developer can finish and verify in one session. Schema plus UI: the
  database part first, as its own issue, the UI blocked by it.
- Defaults when filing autonomously: priority Low (Medium for a security or data-integrity bug),
  flagged in the report.
- Only the supervisor and the scoper write to the tracker.

## Scope

The whole backlog in GitHub Issues is in scope; nothing is phased. Anything labelled
`ready-for-human` or `needs-info` is not dispatched.

## Hard rules for implementers

- **The database is the authority** ([ADR 0001](./adr/0001-supabase-as-the-only-backend.md)): money,
  access and capacity rules live in Postgres (constraint, trigger, RLS, `SECURITY DEFINER`), never only
  in React.
- **No production or Preview database writes**: no `supabase db push`, no `--linked` writes. Schema
  changes are new files from `supabase migration new <name>`; never edit the baseline or an applied
  migration; fix forward ([ADR 0014](./adr/0014-ci-applies-migrations-on-merge.md)).
- **Redefining a SQL function, view or policy**: copy its body from the **latest** migration on
  `origin/main` that defines it
  (`git grep -l "FUNCTION public.<name>(" origin/main -- supabase/migrations | sort | tail -1`), name
  the source migration in a comment, diff your body against it (only your intended edits may
  differ), and redo the check after every merge of `origin/main`.
- **Migration timestamps**: newer than every migration on `origin/main` (CI's `db push` refuses older
  ones); re-date with `git mv` after merging main if needed.
- **Playwright projects**: prefer an existing project; a new one goes at the end of the dependency
  chain, said in the report.
- Pricing rule changes get a case in `src/lib/pricingEngine.test.js` ([ADR 0003](./adr/0003-pricing-as-a-pure-module.md)).
- French UI strings in `src/locales/fr.json`; database values mapped through
  `src/lib/registrationOptions.ts`; database errors are codes mapped to French
  ([ADR 0021](./adr/0021-database-errors-are-codes.md)).
- No hard deletes ([ADR 0024](./adr/0024-no-hard-deletes.md)).
- UTF-8 without BOM.
- **Never open a visible window on the user's desktop.**

## Review

Needs review (any of): a migration; an RLS policy; a `SECURITY DEFINER` function; a trigger or
constraint; pricing or payment; auth or roles; concurrency. Not reviewed, whatever the size: UI,
copy, docs, tests, refactors without schema.

**Low-risk migration**: one that only drops objects nothing calls any more (no new or changed
function, policy, trigger, constraint or column). It is still reviewed, but the developer runs the full
verification straight away, while the review runs; a rework round reruns only what its change touches.

Reviewer checklist, in priority order:
1. **Enforcement lives in Postgres.** RLS: can a member read or write another member's rows? Does an
   admin-only path work for a non-admin? Edition roles (Comité, Organisateur, [ADR 0023](./adr/0023-edition-roles.md),
   [ADR 0026](./adr/0026-comite-does-not-see-finances.md)). `SECURITY DEFINER`: `search_path` pinned,
   the caller authorised inside the function, no privilege leak through arguments.
2. **Non-client callers of a tightened write path**: the demo seed, `seed.sql`, CI scripts and
   service-role Edge Functions still pass it ([Contributing, rule 4](./08-contributing.md#ground-rules)).
3. **Migrations**: new file only; safe on production data (backfills, `NOT NULL` on existing rows,
   locks on big tables).
4. **Stale copies**: every redefined function, view or policy diffed against its latest definition
   on `origin/main`; anything beyond the intended edit (a reverted later fix, most often) is high.
5. **Concurrency**: races between two admins, or a member and an admin; check-then-write without a
   lock or constraint.
6. **Pricing**: `pricingEngine.ts` stays pure; every rule change has a test.
7. **Correctness against the acceptance criteria**, edge cases: empty, cancelled, archived, null,
   both roles.
8. **Errors and i18n**: `fr.json`, `registrationOptions.ts`, error codes mapped to French.
9. **Tests** prove the criteria and would fail on the old code.
10. **Hard rules for implementers** above; challenge the item's or brief's own design against them.

Severity examples: critical = money wrong, an access-control hole, data loss, a migration that breaks
production; high = an acceptance criterion not met, a realistic bug in a main flow; medium = an
edge-case bug, a missing test for a rule.

Visual review: the branding (YULmix barcode, admission-ticket metaphor) is fixed, never proposed for
a redo. Widths: 390px (no horizontal scroll), 1440px, 2560px (content clamped and centred).

## Model selection

Sonnet by default, for every role. Opus for:
- a developer and its reviewer on an issue whose Effort is High **and** that touches RLS,
  `SECURITY DEFINER` functions or money;
- a reviewer of money, or of a new `SECURITY DEFINER` function that grants access;
- a developer on a UI-heavy issue (a new screen or view, a redesign, a layout-heavy change);
- a scoper whose issues will amend a core-rules ADR (pricing, roles, money).

When unsure, Sonnet.

## Parallelism

Two issues may run in parallel only if all hold: no migration in either, or migrations that
create or redefine **disjoint** SQL objects (no shared function, policy, trigger or column); no
shared source files or sections (`git grep` the components, stores, `src/lib` modules and specs each
would touch); at most one adds a Playwright project or changes `playwright.config.js`; no blocking
relation and no contract one relies on. If that can't be established cheaply, run them in sequence.
`FLEET_MAX_LANES=2` caps it.

## CI and PRs

One workflow, **Build, test, deploy** (`.github/workflows/deploy.yml`). On a PR: *Build & test* (`npm
run lint`, `lint:diff`, build, typecheck, `npm test`, the Deno tests and type check), *Migrations
apply cleanly*, *Lint migrations (squawk)* (migration PRs) and the Vercel *Deploy preview*. On merge
to `main`, when it adds migrations: a production backup, *Apply migrations to production*, *Apply
migrations to Preview* and the Edge Functions; then the production deploy. **Reset Preview DB**
(`preview-db-reset.yml`) is run by hand, on any branch. The supervisor owns *Build, test, deploy*
on `main` (`FLEET_CI_WORKFLOWS`) and checks the latest *Reset Preview DB* run by hand (`gh run list
--workflow preview-db-reset.yml --limit 1`), since its last run on `main` says nothing about Preview
today.

PR body: a summary, what was and wasn't verified (from the developer's report), a **What changes for
you locally** line (or "nothing"), any merge-order note, a `Closes #n` line, and the Claude Code
footer. PRs are assigned to the organiser. **Only the organiser merges**: merging applies migrations
to production. A PR is reported as ready (CI green), nothing more.

## Commits

`<type>(<scope>): <short description> (#N)`, e.g. `feat(admin): Couchage chips show who sleeps there (#303)`;
types `feat`, `fix`, `test`, `docs`, `chore`, `refactor`. The PR title follows the same format.
Never commit a broken build or failing tests. Trailer: `Co-Authored-By:` naming the model actually
running.

## Overrides

Rules here replace the generic agent rules they contradict. The agent files under `.claude/agents/`
stay as installed.

### All agents

- Merging `origin/main` into a branch is a merge commit, never a rebase; nobody force-pushes, except
  the supervisor publishing a restacked stacked branch.

### Supervisor

- **Capacity: one issue at a time.** A second developer only when the two issues pass every
  "Parallelism" condition; say why in the plan. Filling every lane would only queue developers on the
  database lock, and parallel branches here have collided on the e2e dependency chain, redefined SQL
  functions and migration timestamps.
- **Preview database failures come first.** A failed *Reset Preview DB* or *Apply migrations to
  Preview* run is diagnosed and fixed before anything else is dispatched (it blocks the organiser's
  testing, #275). After each merge that adds a migration, check *Apply migrations to Preview*.
- **Apply a migration PR to Preview once CI is green**, so the organiser can try the Vercel preview
  (CI only applies to Preview after a merge). From the branch's worktree:
  `PREVIEW_DB_URL=$(grep '^PREVIEW_DB_URL=' ~/code/yulmix-la-bedaine/.env.preview.local | cut -d= -f2-) npm run db:preview:push -- --yes`.
  It applies the branch's pending migrations, or resets Preview from the branch when Preview holds a
  migration the branch lacks (the output says so; tell the organiser). The script refuses any URL
  that isn't Preview. Preview is shared: one migration branch at a time; say in your status which
  branch Preview matches, and don't push a second one until the organiser says the first is tested.
  No migration in the PR → skip.
- **Never merge**, even with `land.sh` available: merging applies migrations to production.
- **Keep optional cleanups out of urgent fixes.** Dropping a now-unused function, column or file is
  its own issue, filed after the fix ships: in the fix it turns a UI change into a reviewed migration
  with the full database verification (#308).

### Developer

- A `review: yes` round still runs the cheap checks and the specs it added or changed under the
  lock before reporting; the full verification (whole e2e suite, `test:rls`) comes after review,
  except for a low-risk migration (see "Review"), which runs it in parallel with the review.
- **Waiting on a long command** (the e2e suite, `test:rls`, `db:local:demo`): run it with the Bash
  tool's `run_in_background` and wait for its completion notice. Never poll with `pgrep -f <text>` (it
  matches the polling shell itself, whose command line holds the same text, and never ends) or an
  `until` loop on a log file. Lost #308 about 13 minutes.

### Code reviewer

### Scoper

- Every issue and every comment you post starts with `> *This was generated by AI during triage.*`.
- Issue body: `## Problem` / `## Desired` (or Steps to reproduce / Expected for a bug), in the
  domain's words, French UI strings quoted as «…». Then a comment `## Agent Brief`: Category, Summary,
  Decided in triage (dated), Blocked by, Current behaviour, Desired behaviour, Key interfaces (no file
  paths or line numbers), Acceptance criteria as checkboxes, Out of scope, plus: which Postgres
  object enforces the rule, the roles that can see or do it (member, admin, Comité, Organisateur),
  which docs change, which tests prove it (RLS suite, pricing test, e2e as member and admin), what
  makes it risky (migration, RLS, `SECURITY DEFINER`, money, auth, concurrency), and functions another
  open issue also redefines.
- An epic is charted with the wayfinder method when a `wayfinder` skill is installed: the map is an
  issue labelled `wayfinder:map`, its tickets are sub-issues labelled
  `wayfinder:research|prototype|grilling|task`. When the map is clear, turn its decisions into
  implementation issues wired in order.

### Designer

### Tester

## Memory

Engram, if installed, uses project `yulmix-la-bedaine`, and holds only situational know-how: tool
gotchas, environment quirks, how to run or fix something. Decisions (design, product, process) go in
an ADR or the relevant doc in this repo, in the PR they belong to, never in memory.
