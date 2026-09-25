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
  PROFILES ||--o{ APP_FEEDBACK : "submits"
  USER_PARTIES ||--o{ REGISTRATION_EDITS : "audited by"

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
    text status "DRAFT|ACTIVE|ARCHIVED"
    bool is_active "partial unique: only one TRUE"
    bool is_reg_open
    numeric total_cost "internal estimate"
    jsonb cost_breakdown
    text expense_category
    numeric selling_price_whole_event "drives what members owe"
    numeric estimated_individual_cost_whole_event
    int max_attendees
    jsonb external_links
    text instructions
    timestamptz created_at
  }
  USER_PARTIES {
    uuid id PK
    uuid user_id FK
    uuid event_id FK
    jsonb attendees
    jsonb counts "trigger-computed"
    jsonb logistics
    jsonb transport
    text music_requests
    text message_to_organizers
    text confirmation_message
    text status
    numeric calculated_amount_owed "client-computed"
    text payment_status "unpaid|paid"
    bool is_waitlisted "trigger-computed"
    text admin_notes "organisers only"
    timestamptz last_edited_at
    int edit_count
    timestamptz created_at
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

`UNIQUE (user_id, event_id)` on `user_parties` is what makes the registration form an *upsert*
rather than an insert: one party per person per event, editable forever.

## JSONB payload shapes

Four columns carry structured data. These shapes are a contract between the form, the triggers and
the admin screens, and nothing validates them — treat changes here as breaking.

### `user_parties.attendees`

**What the code actually writes** (`src/components/RegistrationForm.jsx:200`):

```json
[
  {
    "name": "Jean Tremblay",
    "type": "Adult",                  // 'Adult' | 'Teenager' | 'Kid'
    "participation": "Whole",         // 'Whole' | 'Main' | 'After-Party'
    "is_new_member": false,
    "sleeping_preference": "bed",     // camping | floor | bed | sofa
    "bed_reason": "health",           // health | children | comfort (required if bed)
    "dietary_needs": "vegetarian",    // none | vegetarian | vegan | gluten_free | other
    "dietary_other": ""
  }
]
```

**What the schema documents and the counts trigger expects**
(the baseline migration's `COMMENT ON COLUMN … attendees`; `update_attendee_counts` has since
been fixed to read `type`/`participation` instead):

```json
[{ "name": "…", "tier": "adult_whole", "is_new_member": false }]
```

> ⚠️ **These two shapes used to disagree, and it was not cosmetic.** The trigger read
> `attendee->>'tier'`, which is absent from every row the app writes, so it computed an all-zero
> `counts` object and overwrote whatever the client sent — every admin aggregate that read `counts`
> read zero. Fixed in code (the trigger now derives the tier from `type`/`participation`), but the
> fix still needs deploying to the live database — see
> [issue #34](https://github.com/YULmix/yulmix-la-bedaine/issues/34).

Per-attendee logistics living inside `attendees` (rather than in the party-level `logistics`) is
deliberate — see [ADR 0004](./adr/0004-per-attendee-logistics-inside-attendees.md).

### `user_parties.counts`

```json
{ "adult_whole": 0, "adult_main": 0, "teen_whole": 0, "teen_main": 0, "kids": 0 }
```

Derived, never authored. Exists so admin dashboards can aggregate without unpacking `attendees`.

### `user_parties.logistics`

```json
{
  "sleeping":       { "pref": "bed", "reason": "health", "assigned": "Chambre 2, lit A" },
  "food_requests":  { "requests": "vegetarian, gluten_free", "notes": "free text" },
  "volunteering":   ["cook_meal", "dj_evening"]
}
```

- `sleeping.pref` / `reason` are copied from the **first attendee only**
  (`src/components/RegistrationForm.jsx:264`) — a party-level summary of per-person data.
- `sleeping.assigned` is **admin-write only**: the member asks, the organiser answers
  (`src/views/AdminView.jsx:366`).
- `food_requests.requests` is a comma-joined string of raw option values across all attendees, and
  admin aggregation does substring matching on it (`src/views/AdminView.jsx:939`) — fragile, but
  currently the only food summary there is.

### `user_parties.transport`

```json
{ "type": "offer", "seats": 3, "arrival": "2026-05-01T17:00", "departure": "2026-05-03T14:00" }
```

`type` is `offer` (has room in a car) or `need` (looking for a lift). The schema default is the
string `"None"`, which is not one of the two option values — harmless today, confusing later.

### `events.cost_breakdown` and `events.external_links`

```json
// cost_breakdown
[{ "category": "Chalet", "amount": 1500 }, { "category": "Food", "amount": 1000 }]
// external_links — labels are free text; "Liste d'achats" is the one users look for
[{ "label": "Liste d'achats", "url": "https://…" }]
```

## Enumerations

Postgres `CHECK` constraints, not Postgres enum types — so adding a value means an `ALTER TABLE`.

| Column | Allowed values | Notes |
|---|---|---|
| `events.status` | `DRAFT`, `ACTIVE`, `ARCHIVED` | Mirrored by `is_active`; the two can drift |
| `events.expense_category` | `Chalet`, `Food`, `Music`, `Tech`, `Accessories` | Unused by the UI |
| `user_parties.payment_status` | `unpaid`, `paid` | English values — see [ADR 0012](./adr/0012-migrate-status-columns-to-english.md), which migrated this from French |
| `user_parties.status` | `registered`, `pending`, `cancelled` | RLS and a view treat `registered`/`pending` as editable; `cancelled` is specified but never written |

## Derived state: who computes what

| Field | Computed by | Trusted? |
|---|---|---|
| `counts` | `update_attendee_counts` (BEFORE INSERT/UPDATE OF attendees) | Yes — but currently produces zeros, see above |
| `is_waitlisted` | `enforce_capacity_and_waitlist` (BEFORE INSERT/UPDATE), advisory-locked per event | Yes |
| `edit_count`, `last_edited_at` | `increment_edit_count` (BEFORE UPDATE) | Yes |
| `registration_edits` rows | `log_registration_edit` (AFTER UPDATE), field-by-field diff | Yes, but attributed to `NEW.user_id` — so an admin's god-mode edit is logged as the *member's* edit |
| `calculated_amount_owed` | **The browser**, written as a plain value | **No** |
| `profiles.is_admin` on signup | `handle_new_user`, true iff email is the root admin | Yes |

## Triggers and constraints, in full

```mermaid
flowchart TD
  subgraph events
    E1["BEFORE DELETE → prevent_event_deletion()<br/>raises: events can never be deleted"]
    E2["partial UNIQUE INDEX only_one_active_event<br/>WHERE is_active = TRUE"]
  end
  subgraph profiles
    P1["AFTER INSERT on auth.users → handle_new_user()<br/>creates profile, sets root admin"]
    P2["BEFORE UPDATE → prevent_self_privilege_escalation()<br/>nobody edits their own is_admin"]
    P3["BEFORE UPDATE → protect_root_admin()<br/>root admin can never be demoted"]
    P4["REVOKE UPDATE (is_admin) FROM authenticated<br/>forces rpc admin_set_is_admin()"]
  end
  subgraph user_parties
    U1["BEFORE INSERT/UPDATE OF attendees → update_attendee_counts()"]
    U2["BEFORE INSERT/UPDATE OF attendees,status → enforce_capacity_and_waitlist()"]
    U3["BEFORE UPDATE → increment_edit_count()"]
    U4["AFTER UPDATE → log_registration_edit()"]
  end
```

### Capacity and waitlisting

`enforce_capacity_and_waitlist` (baseline migration) is the one piece of concurrency-aware logic
in the system. **In production it is currently defeated.** Step 3 filters on the old French status
values, which no row has any more, so it counts zero existing attendees
([#49](https://github.com/YULmix/yulmix-la-bedaine/issues/49)). As designed, it:

1. Reads `max_attendees` for the event; if null or ≤ 0, clears the waitlist flag and returns.
2. Takes `pg_advisory_xact_lock(hashtext(event_id))` so two simultaneous registrations cannot both
   pass the capacity check.
3. Sums `jsonb_array_length(attendees)` over all non-waitlisted, non-cancelled parties for the
   event, excluding the row being written.
4. Adds this party's size; if the total exceeds `max_attendees`, sets `is_waitlisted = TRUE`.
5. Always overwrites the client's `is_waitlisted`.

Two properties worth knowing: waitlisting is **all-or-nothing per party** (a party of 4 that
straddles the cap goes entirely to the waitlist), and nothing ever moves a party *off* the waitlist
when someone else cancels — that is a manual admin action today, and there is no UI for it.

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
