# Data model

Everything in this document is derived from `supabase/migrations/`. Its first file,
`20260924233313_baseline_live_schema.sql`, is a dump of the production schema as of 2026-09-24
([ADR 0013](./adr/0013-supabase-migrations.md)). Later migrations change it from there. Where
production has a known defect, it is called out.

## Entity relationships

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "trigger on insert"
  PROFILES ||--o{ USER_PARTIES : "registers"
  EVENTS ||--o{ USER_PARTIES : "receives"
  USER_PARTIES ||--o{ ATTENDEES : "has (on delete cascade)"
  EVENTS ||--o| EVENT_BUDGETS : "budgeted by (admin-only)"
  PROFILES ||--o{ APP_FEEDBACK : "submits"
  USER_PARTIES ||--o{ REGISTRATION_EDITS : "audited by"
  USER_PARTIES ||--o{ EMAIL_LOG : "emailed about"

  AUTH_USERS {
    uuid id PK
    text email
  }
  PROFILES {
    uuid id PK "= auth.users.id"
    text email UK
    text full_name
    bool is_admin "UPDATE revoked from authenticated"
    timestamptz created_at
    timestamptz deleted_at "soft delete, #36"
  }
  EVENTS {
    uuid id PK
    text theme
    text description
    text venue_address
    int duration_days
    text points_of_contact
    int z_intent_months "intent window, months"
    int x_reg_close_weeks "reg close, weeks"
    date reg_start_date
    date event_start_date "when the event itself starts; nullable"
    text status "DRAFT|ACTIVE|ARCHIVED"
    bool is_active "partial unique: only one TRUE"
    bool is_reg_open
    numeric selling_price_whole_event "base price: drives what members owe"
    numeric ratio_main_whole "main-event share, default 0.5375 (#109)"
    int max_attendees
    jsonb external_links
    text instructions
    timestamptz created_at
  }
  EVENT_BUDGETS {
    uuid event_id PK
    jsonb lines "category, description, amount"
    numeric contingency_pct "default 20"
    numeric total_cost "trigger: sum of lines"
    timestamptz updated_at
  }
  USER_PARTIES {
    uuid id PK
    uuid user_id FK
    uuid event_id FK
    jsonb logistics "party-wide: volunteering"
    jsonb transport
    text music_requests
    text message_to_organizers
    text confirmation_message
    text status
    numeric calculated_amount_owed "trigger-computed"
    numeric locked_selling_price_whole_event "base price when registered (#117)"
    numeric locked_ratio_main_whole "ratio when registered (#117)"
    text payment_status "unpaid|paid"
    bool is_waitlisted "trigger-computed"
    text admin_notes "organisers only"
    timestamptz last_edited_at
    int edit_count
    timestamptz created_at
  }
  ATTENDEES {
    uuid id PK
    uuid party_id FK
    int position "display order, unique per party"
    text name "not blank"
    text type "Adult|Teenager|Kid"
    text participation "Whole|Main|After-Party"
    bool is_new_member
    text sleeping_preference "CHECK, '' = not answered"
    text bed_reason "CHECK"
    text dietary_needs "CHECK"
    text assigned_bed "admin-only"
  }
  APP_FEEDBACK {
    uuid id PK
    uuid user_id FK
    text content
    text screenshot_url
    bool is_resolved
    timestamptz created_at
    timestamptz resolved_at
  }
  REGISTRATION_EDITS {
    uuid id PK
    uuid registration_id FK
    uuid edited_by FK
    jsonb changes
    timestamptz edited_at
  }
```

`UNIQUE (user_id, event_id)` on `user_parties` is what makes saving the registration form an
*upsert* rather than an insert: one party per person per event, editable forever.

## Attendees

Each person in a party is a row of `attendees` ([ADR 0018](./adr/0018-attendees-in-their-own-table.md),
#126, which superseded the `user_parties.attendees` JSON array of ADR 0004). `position` is the
display order (from 1, unique per party). The enumerated columns have `CHECK` constraints with the
values of `src/lib/registrationOptions.js`; `''` means "not answered", as it did in the JSON.

| Column | Values |
|---|---|
| `type` | `Adult`, `Teenager`, `Kid` |
| `participation` | `Whole`, `Main`, `After-Party` (kids) |
| `sleeping_preference` (+ `_other`) | `''`, `camping`, `floor`, `bed`, `sofa`, `outside_other` |
| `bed_reason` (+ `_other`) | `''`, `health`, `children`, `comfort`, `other` |
| `dietary_needs` (+ `dietary_other`) | `''`, `none`, `vegetarian`, `vegan`, `gluten_free`, `other` |
| `assigned_bed` | free text set by an admin (#94); replaced by place assignments in #113 |

**One write path.** The form saves a party and its attendees in one transaction with
`save_registration(p_event_id, p_attendees, p_party, p_user_id)`, a `SECURITY INVOKER` function, so
the RLS of both tables applies. It upserts the party, then updates the attendees whose `id` it is
sent, inserts the others and deletes the ones left out, then updates the party so its triggers
recompute what depends on the attendees. Saving registers the party (again, if it was cancelled).
An admin saves someone else's registration by passing `p_user_id`.

`trg_guard_attendee_write` refuses any other write to `attendees` from a client
(`attendees_write_through_save_registration`), with two exceptions: an admin changing only an
`assigned_bed`, and the cascade when an admin deletes a party. `save_registration()` marks the party
it is saving in a transaction-local setting (`bedaine.saving_party`) that PostgREST gives clients no
way to set. It never writes `assigned_bed`: a bed stays with its attendee, by id, whatever the member
edits.

**Reading.** Embed them: `user_parties(*, attendees(*))`, ordered by `position`
(`src/lib/parties.js`). Screens receive an `attendees` array, as they did with the JSON.

## JSONB payload shapes

Three columns carry structured data. These shapes are a contract between the form and the admin
screens, and nothing validates them — treat changes here as breaking.

### `user_parties.logistics`

```json
{ "volunteering": ["cook_meal", "dj_evening", "other"], "volunteering_other": "free text" }
```

Party-wide answers only. Everything about a person (sleeping, bed, food) is on their attendee row.
`sleeping` (a copy of the first attendee's choice) and `food_requests` (a join of everyone's dietary
needs) were removed with the move to the attendees table (#126); older `registration_edits` rows
still contain them.

### `user_parties.transport`

```json
{ "type": "offer", "seats": 3, "arrival": "2026-05-01T17:00", "departure": "2026-05-03T14:00" }
```

`type` is `offer` (has room in a car) or `need` (looking for a lift). The schema default is the
string `"None"`, which is not one of the two option values — harmless today, confusing later.

### `event_budgets.lines` and `events.external_links`

```json
// event_budgets.lines (admin-only, #109). Checked by a trigger, which also sets total_cost.
[{ "category": "Chalet", "description": "Location du chalet", "amount": 1500 },
 { "category": "Food", "description": "Épicerie", "amount": 1000 }]
// external_links — labels are free text; "Liste d'achats" is the one users look for
[{ "label": "Liste d'achats", "url": "https://…" }]
```

`event_budgets` has one row per event (`event_id` is the primary key): `lines`, `contingency_pct`
(default 20) and `total_cost`, always the sum of the lines. Admins only, for reading too: it is the
simulation the organisers set the price from, and never feeds an amount (see
[Pricing](./04-pricing-and-business-rules.md#the-budget-and-the-break-even-price)).

## Enumerations

Postgres `CHECK` constraints, not Postgres enum types — so adding a value means an `ALTER TABLE`.

| Column | Allowed values | Notes |
|---|---|---|
| `events.status` | `DRAFT`, `ACTIVE`, `ARCHIVED` | Mirrored by `is_active`; the two can drift |
| `event_budgets.lines[].category` | `Chalet`, `Food`, `Music`, `Tech`, `Accessories`, `Other` | Checked by the `enforce_event_budget` trigger, not a column constraint (the values live in jsonb) |
| `user_parties.payment_status` | `unpaid`, `paid` | English values — see [ADR 0012](./adr/0012-migrate-status-columns-to-english.md), which migrated this from French |
| `user_parties.status` | `registered`, `pending`, `cancelled` | RLS and a view treat `registered`/`pending` as editable; `cancelled` is written when a member un-registers (#35). A cancelled party owes nothing (no refunds): the admin totals, logistics and exports leave it out, and the users tab lists it only under "Annulées" (#101) |

## Derived state: who computes what

| Field | Computed by | Trusted? |
|---|---|---|
| `is_waitlisted` | `enforce_capacity_and_waitlist` (BEFORE INSERT/UPDATE OF status), advisory-locked per event | Yes |
| `edit_count`, `last_edited_at` | `increment_edit_count` (BEFORE UPDATE); the update that completes a new registration isn't counted | Yes |
| `registration_edits` rows | `log_registration_edit` (AFTER UPDATE), field-by-field diff; `attendees` holds the party's attendees before and after a `save_registration()`, as JSON arrays | Yes, attributed to `auth.uid()` |
| `calculated_amount_owed` | `enforce_calculated_amount_owed` (BEFORE INSERT/UPDATE), from the party's `attendees` rows and its locked price; frozen once paid (#31) | Yes |
| Headcount per tier | Not stored: counted from `attendees` where needed (`tierCountsOf()` in `src/lib/adminStats.js`) | — |
| `locked_selling_price_whole_event`, `locked_ratio_main_whole` | `enforce_calculated_amount_owed`: the event's values on insert (or on re-registering after a cancellation), the stored ones on update; locked when the event first gets a price if it had none (#117) | Yes |
| `profiles.is_admin` on signup | `handle_new_user`, true iff email is the root admin | Yes |
| `profiles.deleted_at` | `delete_my_account()` only; `protect_profile_deleted_at` (BEFORE INSERT/UPDATE) keeps the stored value on any direct client write | Yes |

## Triggers and constraints, in full

```mermaid
flowchart TD
  subgraph events
    E1["BEFORE DELETE → prevent_event_deletion()<br/>raises: events can never be deleted"]
    E2["partial UNIQUE INDEX only_one_active_event<br/>WHERE is_active = TRUE"]
    E3["AFTER UPDATE OF selling_price_whole_event → lock_unpriced_registrations_on_first_price()<br/>only when the price goes from ≤ 0 to > 0 (#117)"]
  end
  subgraph profiles
    P1["AFTER INSERT on auth.users → handle_new_user()<br/>creates profile, sets root admin"]
    P2["BEFORE UPDATE → prevent_self_privilege_escalation()<br/>nobody edits their own is_admin"]
    P3["BEFORE UPDATE → protect_root_admin()<br/>root admin can never be demoted"]
    P4["REVOKE UPDATE (is_admin) FROM authenticated<br/>forces rpc admin_set_is_admin()"]
    P5["BEFORE INSERT/UPDATE → protect_profile_deleted_at()<br/>only SECURITY DEFINER code sets deleted_at"]
  end
  subgraph user_parties
    U2["BEFORE INSERT/UPDATE OF status → enforce_capacity_and_waitlist()"]
    U3["BEFORE UPDATE → increment_edit_count()"]
    U4["AFTER UPDATE → log_registration_edit()"]
    U5["BEFORE UPDATE/DELETE → enforce_registration_lock_after_close_date()"]
    U6["BEFORE INSERT/UPDATE → enforce_calculated_amount_owed()<br/>locked price and amount owed (#31, #117)"]
  end
  subgraph attendees
    A1["BEFORE INSERT/UPDATE/DELETE → guard_attendee_write()<br/>only through save_registration(), or an admin's bed"]
    A2["AFTER UPDATE OF assigned_bed → request_party_email()<br/>when an attendee gets a bed"]
  end
```

### Capacity and waitlisting

`enforce_capacity_and_waitlist` is the one piece of concurrency-aware logic in the system. It is
`SECURITY DEFINER`, so it counts every party whoever writes: under the member's RLS it used to see
only the member's own party, and never waitlisted a member (#118). It:

1. Reads `max_attendees` for the event; if null or ≤ 0, clears the waitlist flag and returns.
2. Takes `pg_advisory_xact_lock(hashtext(event_id))` so two simultaneous registrations cannot both
   pass the capacity check.
3. Counts the `attendees` rows of all non-waitlisted, non-cancelled parties for the event,
   excluding the row being written (`private.event_headcount`).
4. Adds this party's size; if the total exceeds `max_attendees`, sets `is_waitlisted = TRUE`.
5. Always overwrites the client's `is_waitlisted`.

It runs on insert and on any update that sets `status`, which `save_registration()`'s last step
always does, so it sees the party's attendees as saved.

Waitlisting is **all-or-nothing per party** (a party of 4 that straddles the cap goes entirely to
the waitlist). When a party is cancelled, `promote_waitlisted_parties` moves waitlisted parties off
the list, oldest first, while they fit.

### Transactional emails

`trg_request_party_email_on_insert` (every insert), `trg_request_party_email_on_update` (only
when `is_waitlisted`, `payment_status` or `status` changes) and, on `attendees`,
`trg_request_party_email_on_bed` (an attendee gets an `assigned_bed`) ask the `send-party-email` Edge Function, through pg_net, to look
at the party ([ADR 0016](./adr/0016-edge-function-for-transactional-email.md), #12). The function
decides what is owed from the committed row and `email_log`:

| Template | Owed when |
|---|---|
| `registration` | active event, not cancelled, not waitlisted, never sent a `registration` or `waitlist` email |
| `waitlist` | waitlisted and never sent one |
| `promotion` | no longer waitlisted after a `waitlist` email, and never sent one |
| `payment` | `payment_status = 'paid'`, not waitlisted |
| `accommodation` | at least one attendee has an `assigned_bed`, not waitlisted |

`email_log` has one row per party and template (unique), claimed before sending, so each email goes
out at most once whatever happens later (paid, unpaid, paid again sends one receipt). `status` is
`sent`, `failed` (Resend refused; never retried), `dry_run` (no `RESEND_API_KEY` in that
environment), `pending` (claimed, send in progress or interrupted) or `backfilled` (the state
already held when the table was created; nobody was emailed about it). Admins can read it; nobody
writes it but the function (service role).

Members read their own emails through `my_party_emails(p_party_id)` (#93), a `SECURITY DEFINER`
function that returns only `template`, `sent_at` and `sent` | `not_sent` (for `failed`), for a
party the caller owns. `pending`, `dry_run` and `backfilled` rows are left out: no email went out
for them. The app shows this under the member's Pass. Admins see every row in the party's edit
dialog, and `failed` + `pending` rows for the active event in Vue d'ensemble.

The function's URL is per environment, in `private.settings` (`email_function_url`): the local
seed sets it, CI sets it in production. Preview loads the same seed, so its URL points at a host
that only exists locally: the request fails and nothing is sent. Where it's unset, the trigger
does nothing.

### Registration close date

`enforce_registration_lock_after_close_date` (added for
[#38](https://github.com/YULmix/yulmix-la-bedaine/issues/38)) is the only place the "registration
close date" — `events.event_start_date - events.x_reg_close_weeks` weeks — is actually enforced,
with `save_registration()` for the attendees (both use `private.registration_closed`). Neither
blocks new registrations, edits, or adding participants; they only block, once the close date has
passed and the caller isn't an admin:

- `DELETE` on `user_parties` (members can't delete at all since #35; this is a second guard).
- `UPDATE` on `user_parties` that moves the row to `cancelled` (a member un-registering, #35).
- A `save_registration()` that leaves the party with fewer attendees than it had (a member removing
  a participant), unless the row was `cancelled`: registering again with a smaller group isn't
  removing anyone from a registration that owed something. Replacing someone is allowed. This check
  is in `save_registration()`, the only place that sees the attendees before and after a save.

The app mirrors the date with `getRegistrationCloseDate()` / `isRegistrationLocked()` in
`src/lib/eventPhase.js`, to hide "Se désinscrire" and explain why; the trigger is what enforces it.

The amount already owed is never reimbursed by this trigger — it just stops the row (or the
attendee list) from shrinking. If either `event_start_date` or `x_reg_close_weeks` is null, the
trigger is a no-op, since there is nothing to compute the close date from.

## Views

| View | Purpose | Notes |
|---|---|---|
| `user_event_history` | Joins `profiles` × `user_parties` × `events` so admins can drill into a member's history across editions | `WITH (security_invoker = true)`, so the querying user's RLS applies: members see only their own rows. `SELECT` for `authenticated` only |

`registration_summary_view` no longer exists. It was unused and bypassed RLS, and was dropped in
production on 2026-09-18 (`supabase/legacy/fix_views_security.sql`).

## Extending the model — the checklist

1. Add a migration (`supabase migration new <name>`) with the `ALTER TABLE`, and check it locally
   with `supabase db reset`. It reaches production when its PR merges (CI runs `supabase db push`);
   see [Development setup → Database migrations](./07-development-setup.md#database-migrations).
2. If it is user-visible, add an RLS consideration: does the new column leak anything a member
   should not see? `admin_notes` is the precedent for organiser-only data.
3. If it is an enum-like value, add it to `src/lib/registrationOptions.js` with a French label, and
   the label to `src/locales/fr.json`. Never render the raw value.
4. If it is derived, prefer a trigger over client computation — the browser is not trusted.
5. Update this document and the ERD above.

## Account deletion (#36)

Deleting an account is a soft delete, and no row is ever removed. `profiles.id` cascades from
`auth.users` and `user_parties.user_id` from `profiles`, so a hard delete would wipe the member's
registration and payment history.

`delete_my_account()` (a `SECURITY DEFINER` RPC, callable by `authenticated`) does all of it in one
transaction:

1. It refuses, changing nothing, if the member has an active registration (`registered` or
   `pending`) for an event that isn't over and whose [registration close date](#registration-close-date)
   has passed. The amount owed stays owed. It also refuses for the root admin. Refusals are
   raised as codes, not French text: `account_deletion_locked` (with `details` =
   `{"event", "close_date"}`), `root_admin_cannot_be_deleted` and `not_authenticated`. The app
   maps them to `fr.json` through `src/lib/dbErrors.js`.
2. It cancels the member's active registrations for events still to come, meaning not archived
   and not over (`event_start_date + duration_days`). This is the same soft status change as a
   member's own cancellation (#35), so the waitlist is promoted. Registrations for past or
   archived events are history: they aren't touched, and they never block a deletion.
3. It stamps `profiles.deleted_at`.

After that, the account has no member access. The member-side RLS policies require
`is_account_active()`, and `is_admin()` is false for a deleted profile. The one thing still readable
is the member's own profile row, which is how the app knows to show "Compte supprimé". Admins
still see the member's past registrations (`user_event_history`), but no longer see them among the
current edition's parties. Reactivating an account isn't built.
