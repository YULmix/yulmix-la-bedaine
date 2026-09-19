# State of the code

A ranked, evidence-backed inventory of what is broken or owed, as of **2026-09-17**, branch
`docs/add-some-documentation` (working tree clean, 14 commits, one author).

Each item says how it was established. **Verified** means it was executed or read directly in this
repo. **Unverified** means it depends on the live Supabase project, which was not accessible.

## Verified working

Worth stating plainly, because the list below is long:

- `npm run build` succeeds — 1943 modules, ~1.3s, chunks split per `vite.config.js`.
- `npm test` and `npm run test:pricing` both pass — 5/5 pricing cases, as genuine Jest `test()`
  blocks. The RLS integration suite (`npm run test:rls`) is deliberately excluded from `npm test`
  since it needs a live Supabase instance; run on its own it now fails on `ECONNREFUSED` rather
  than the `fetch`-related jsdom artifact it used to.
- The pricing engine correctly implements the selling-price model, the new-member downgrade + 30%
  reduction, the round-up-to-$10 internal cost, and the zero guards.
- The security design is layered and sound in its intent: RLS on every table, a non-recursive
  `is_admin()`, three independent defences against admin self-promotion, no-delete on events,
  single-active-event index, and an advisory-locked capacity trigger.
- Localisation has a real centralised dictionary and a value↔label mapping layer, so raw enums do not
  leak into the UI.

## P1 — correctness and integrity

### 1. `counts` is always zero, so every admin aggregate is wrong

**Verified by reading.** `update_attendee_counts` reads `attendee->>'tier'`
(`supabase/schema.sql`), but the app writes attendees as `{type, participation}` with no `tier` key
(`src/components/RegistrationForm.jsx:200`). The trigger fires `BEFORE INSERT OR UPDATE OF attendees`
and unconditionally assigns its computed object, discarding the correct counts the client had
already calculated (`RegistrationForm.jsx:220`).

Consequence: the adults/teens/kids tiles (`AdminView.jsx:880`), the CSV and clipboard exports
(`:513`, `:597`), and `calculateEstimatedCostPerParticipant` (which reads `counts`) all report zero.

*Unverified:* the live database may carry a corrected trigger — the admin dashboard has apparently
been used. Check the deployed function before changing anything.

Fix: pick one attendee shape and make trigger, form, exports and the schema comment agree. Prefer
teaching the trigger `type`/`participation`, since that is what every JS caller and the pricing
engine already use, and `tier` exists only in the schema comment.

### 2. The amount owed is computed in the browser and trusted

**Verified by reading.** `calculated_amount_owed` is written as a plain value from client state
(`src/components/RegistrationForm.jsx:312`); the RLS UPDATE policy lets a member write their own row;
no trigger recomputes it. Anyone with devtools, or a REST client and their own JWT, can set their
balance to zero.

Fix: recompute in a `BEFORE INSERT OR UPDATE` trigger from `attendees` × the event's
`selling_price_whole_event`. This is also the prerequisite for items 3 and 4.

### 3. Grandfathering is never actually applied

**Verified by reading.** The engine preserves a paid party's amount via `party.is_paid` /
`party.historical_owed` (`pricingEngine.js:145`), but nothing maps those from the real columns
(`payment_status = 'Payé'`, `calculated_amount_owed`). `RegistrationForm` always passes a synthetic
party with `is_paid: false` (`:100`). A member who has paid and then edits their registration after a
price change gets a fresh, different amount.

### 4. Changing the selling price does not reprice anyone

**Verified by reading.** Amounts are snapshots taken at save time. An admin editing
`selling_price_whole_event` leaves every existing `calculated_amount_owed` stale until each member
happens to re-save. Given the stated workflow — collect intentions, *then* set the price a month out
— this is the normal case, not an edge case. A trigger (item 2) plus an admin "reprice unpaid
registrations" action solves it.

### 5. `supabase/schema.sql` is empty on `main`

**Verified (2026-09-18, git).** Commit `a2cec16` reduced the file from 597 lines to a 3-byte BOM.
The full copy survives at `a2cec16^`. Whether that was deliberate is **undetermined**; the evidence
and the recovery path are in [Live environment audit](./11-live-environment.md#the-emptied-supabase-schema-sql).
The schema currently cannot be applied to a fresh environment at all.

*Superseded wording:* this entry previously said the file "does not parse" because of an `AS $`
delimiter in `admin_set_is_admin`. That text was written against the pre-`a2cec16` file and was never
re-checked; the `AS $` fragment is in the scratch file `fixed.txt`. What *is* true of the old file is
that `admin_set_is_admin` had a duplicated `LANGUAGE`/`SECURITY DEFINER` clause that the live database
has since had repaired via `fix_admin_function.sql`.

### 5a. Two views bypassed RLS on the live database — **fixed 2026-09-18**

**Verified (2026-09-18, live catalog + Supabase advisors).** `user_event_history` and
`registration_summary_view` are `SECURITY DEFINER`, and `authenticated` can read (and, by grant,
write) them. `user_event_history` therefore exposes every member's email, name, amount owed and
payment status to any signed-in user. See
[Live environment audit](./11-live-environment.md#live-database) for the evidence and what remains
untested. Fixed by `supabase/fix_views_security.sql` and re-verified; this entry is kept as the record.

### 5b. Production is not deploying `main`

**Verified (2026-09-18, GitHub deployment statuses).** The deploy of `65a6171` was blocked;
production is on `a2cec16`. The project lives in a Vercel account the maintainer cannot see. See
[Live environment audit](./11-live-environment.md#deployment).

### 6. Saving bed assignments reports a failure that did not happen

**Verified by reading.** `saveLogisticsChanges` calls `fetchPartiesForActiveEvent()`
(`src/views/AdminView.jsx:403`) — a function that does not exist anywhere in the file. The UPDATE
succeeds first, then the ReferenceError is caught by the surrounding `catch`, which shows
*"Erreur lors de la sauvegarde"* and skips the refresh. Organisers see an error and a stale table
after a write that worked. Rename to `fetchParties(activeEventState.id)`.

### 7. The app invents an active event when there is none

**Verified by reading.** `fetchEvents` (`src/App.jsx:70`) promotes the most recent event to active
when no event has `is_active`, and falls back to hardcoded demo data ("Weekend en montagne",
`$2500`, `$75`) when the table is empty *or the query errors*. Members can therefore be shown an
archived weekend, or a fictional one, as if registration were open — and the specified
"Aucun événement en cours" state becomes unreachable. Remove the demo fallback; render the empty
state.

## P2 — features specified but missing

| Specified | Status | Evidence |
|---|---|---|
| Feedback module (floating widget, image paste, admin triage, refresh banner) | **Not built.** Table and RLS exist; zero UI references `app_feedback` | grep across `src/` |
| "Se désinscrire" / cancellation to `Annulé` | **Not built.** The form has two "Annuler" buttons and no unregister action | `RegistrationForm.jsx:556`, `:560` |
| "Supprimer mon compte" | **Not built** | grep |
| Waitlist promotion when someone cancels | **Not built.** Nothing ever clears `is_waitlisted` | `enforce_capacity_and_waitlist` |
| Registration close at `x_reg_close_weeks` | **Not enforced.** Value is displayed only | `EventDetailsView.jsx` |
| Confirmation emails (registration, payment received) | Backlog, not built | requirements backlog |
| Venue address as a Google Maps link | Backlog, not built | requirements backlog |
| Archive warning / single-step archive-and-activate confirmation | Archiving has no confirmation | `AdminView.jsx:156` |
| Rename "Tableau de bord admin" → "Admin" | Still the long label | `Header.jsx:95` |

Note the event has **no event date column** at all — only `reg_start_date` and `duration_days`. Any
deadline logic beyond the intent phase needs one.

## P3 — code quality and dead weight

- **`aggregateTotals()` is a stub that returns zeros** and is never called (`AdminView.jsx:292`).
  Delete it or implement it; as written it reads like working code.
- **`AdminView.jsx` is 1364 lines** covering eight distinct screens. The highest-value refactor in
  the repo, and the main future merge-conflict surface.
- **Two missing i18n keys render as nothing**: `fr.dates` (`EventModal.jsx:129`) and
  `fr.sameForEveryone` (`RegistrationForm.jsx:432`). **Verified** against the 255 keys in `fr.json`.
- **91 of 255 dictionary keys are unused**; ~45 French strings remain hardcoded in JSX, against the
  project's own centralisation rule. **Verified** by script.
- **Three dead locale files**, all invalid JSON: `fr_broken.json`, `fr_fixed.json`, `fr_temp.json`.
  **Verified** — each fails `json.load`.
- **BOMs on five tracked files**: `src/locales/fr.json`, the three dead dictionaries, and
  `src/views/AdminView.jsx` — against `.clinerules`. **Verified** by byte inspection.
- **`src/App.jsx.backup`** — a tracked 355-line copy of an old `App.jsx`.
- **`registration_summary_view`** is defined and referenced by nothing.
- **`formatCurrency` / `formatDate` duplicated** in four or five components. Extract `src/lib/format.js`.
- **Toast machinery duplicated** in `RegistrationForm` and `AdminView`.
- **`window.location.reload()`** as the post-save refresh (`HomeView.jsx:186`, `:205`).
- **Audit log misattributes admin edits**: `log_registration_edit` inserts `edited_by = NEW.user_id`,
  so a god-mode edit by an organiser is recorded as the member's own change. `auth.uid()` is the
  right value.
- **Dietary and sleeping aggregates count parties, not people**, and match dietary needs by substring
  on a comma-joined string (`AdminView.jsx:925`, `:939`). Per-attendee data exists in `attendees`;
  aggregate from there.
- **The simulator never models new members** (`AdminView.jsx:418` always sets `isNewMember: false`),
  so it overstates revenue whenever newcomers are expected.

## P4 — project hygiene

Resolved since this document was first written:

- ~~`npm ci` fails~~ — **fixed.** The lockfile is back in sync with `package.json`.
- ~~`npm test` fails~~ — **fixed.** `pricingEngine.test.js` is now genuine Jest `test()` blocks, the
  RLS suite runs on Node (`@jest-environment node`) instead of jsdom, and it is excluded from the
  default `npm test` run via `jest.config.js` so CI doesn't need a live Supabase — it runs on its
  own via `npm run test:rls` with `jest.rls.config.js`. The placeholder `example.test.js` is deleted.
- ~~`README.md` is stale~~ — **fixed.** It now describes the app as it actually is and points to
  `docs/` and `AGENTS.md`.
- ~~No entry point for agents/contributors~~ — **fixed.** `AGENTS.md` (symlinked as `CLAUDE.md`)
  now exists at the repo root.

Still open:

- **No CI, no linter, no formatter, no pinned Node version.** `npm test` and `npm run build` both
  pass locally, but nothing runs them automatically on a PR — see
  [roadmap, Stage 0](./10-roadmap.md#stage-0--make-the-repo-collaborable). ESLint alone would have
  caught item 6 above (the undefined `fetchPartiesForActiveEvent`).
- **No `supabase/config.toml`**, so `supabase start` — the documented first step for the RLS tests —
  has nothing to work from.
- **`.env.test` is tracked.** Placeholders only today (**verified**, no secret leaked), but it is
  primed to leak a service-role key.
- **`netlify.toml` is dead config.** Production runs on Vercel (`vercel.json`); `netlify.toml` is a
  leftover from before the host was settled and should be deleted.
- **No CI gate in front of the Vercel deploy.** A push reaches production via Vercel's own git
  integration without `npm run build`/`npm test` running first.
- **`.clinerules` hardcodes Windows PowerShell 5.1** shell rules, which are wrong for contributors on
  macOS/Linux, mixed in with genuinely useful project conventions.
- **`index.html` has two `<title>` tags.**
- **`GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated`** — RLS still protects the data, but
  every future table is writable-by-default until someone writes its policies.

## Open questions for the group

These need a decision from the organisers, not a code change:

1. **Is 52.5% the intended new-member price** for an adult attending the whole weekend (main-event
   downgrade *then* 30% off, compounding)? The requirements flag it as "to validate".
2. **What happens when a member cancels after paying?** Refund, credit, or nothing — the data model
   has no concept of it.
3. **Should the waitlist auto-promote** when space frees up, or stay a manual organiser decision?
4. **How much history from the spreadsheet should be backfilled** into `events` / `user_parties`? This
   decides whether `user_event_history` is a real feature or decoration.
