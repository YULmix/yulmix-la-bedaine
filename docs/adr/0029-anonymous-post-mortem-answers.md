# Anonymous post-mortem answers: nothing before the close, then the « levée » erases the link

After an event, the organisers collect a post-mortem, the « bilan »: one free text per category
from each member registered on it, named or anonymous, read by account admins only
([issue #315](https://github.com/YULmix/yulmix-la-bedaine/issues/315), epic #309). The organiser
asked for **true anonymity**: "there should be ZERO ways to associate those comments with their
author", « Voir comme » included. An admin reads every registration, profile and change history,
and can open a member's session; so the author link can't just be hidden on screen, and it can't
stay in the database for good either. **While the window is open, each answer has its author link,
in tables no client role can read, and admins read nothing at all. At the close, one irreversible
step, the « levée », publishes the answers and erases the link of every anonymous one.**

**Status: accepted** (October 2026), implemented by #315: migration
`20261026043829_event_feedback.sql`. The rules were decided by the organiser on #315: in triage
(2026-10-25: comments only, eight categories, admins only, eligibility, the window's opening) and
after the anonymity review (2026-10-26: the offset close, the final close, nothing before it, the
threshold of 3, editing until the close, the accepted backup and log limits). This replaces the
first design of the same branch, in which every answer kept its `author_id` for good and admins
read the answers live.

```mermaid
sequenceDiagram
  participant M as Member
  participant DB as Database
  participant A as Admin
  M->>DB: submit_event_feedback() (window open)
  Note over DB: event_feedback + event_feedback_authors
  A->>DB: event_feedback_answers()
  DB-->>A: closed: false, no answer, no count
  Note over DB: close: archival, or the end of "last day + feedback_days"
  DB->>DB: levée: anonymous answers re-inserted (fresh ids, random order), window rows and links deleted
  A->>DB: event_feedback_answers()
  DB-->>A: named answers with author; anonymous texts only if at least 3
  M->>DB: my_event_feedback()
  DB-->>M: own named answer; an anonymous one can no longer be found
```

## Decisions

- **Two closed tables.** `event_feedback` holds the texts, `is_anonymous` and `event_id`: nothing
  about who or when. `event_feedback_authors` holds the link: answer, `author_id`, `party_id`,
  `created_at`, `updated_at`, one per member per event (`UNIQUE (event_id, author_id)`). Both have
  RLS on, no policy, and no privilege for `anon`, `authenticated` or `service_role`. No view reads
  them, nothing embeds them, they aren't in the Realtime publication. Three `SECURITY DEFINER`
  functions are the only way in, and each names its output.
- **The window and the close.** It opens the day after the event's last day (Toronto day of the
  start + `duration_days`). It closes at the end of the Toronto day "last day +
  `events.feedback_days`" (default 14, from 1 to 365), or at archival if that comes first. A DRAFT
  event, or one without a start date, never opens and never closes by date.
- **The close is final.** `events.feedback_closed_at` is set once, by the levée, and never cleared;
  a trigger refuses any other write to it, by an admin or the database owner. Once set, un-archiving
  the event ([ADR 0008](./0008-archive-never-delete.md) allows it) or a new
  `feedback_days` doesn't reopen anything: every function reads the marker first. Before the close an
  admin may change `feedback_days`; a value that puts the close in the past closes it at once. A
  close date that passed is final even before the levée has run: any update of the event then runs
  it first.
- **Nothing before the close.** `event_feedback_answers()` returns `closed: false`, the close date,
  and `named`/`anonymous` null: no answer, no count, nothing that changes when a member writes. Who
  answered isn't readable by an admin by any path. After the close, named answers carry their
  author (id, party, name, email) and times; anonymous answers carry their texts only.
- **The levée.** `private.event_feedback_levee()` runs once per event, in the `BEFORE UPDATE`
  trigger on `events` (holding the event's advisory lock exclusively, see below), in one
  transaction with setting the marker: at
  archival, at any update of the event once its close date has passed (or that puts it there), and,
  through a no-op update, at the first call of any of the three functions after the close date. It
  re-inserts each anonymous answer as a new row (fresh random id, the event and the texts only), all
  of them in random order, then deletes their window rows, which deletes their links
  (`ON DELETE CASCADE`). The new rows share one `xmin` (the levée's transaction) and carry no time,
  and their physical position doesn't follow the order in which they were written. Named answers
  stay as they are, with their link.
- **The threshold.** Anonymous answers reach admins only when the event has at least 3, in the
  order of their random ids; with 0, 1 or 2 the result is the same (`anonymous: []`). They are
  kept, not deleted.
- **Members edit until the close, from any device**, matched on `author_id = auth.uid()`, and may
  switch named ↔ anonymous. After the close a member reads their named answer; an anonymous one
  has no author any more, so `my_event_feedback()` can't find it: `answer` null then means "no
  named answer", and the database can't say whether there was an anonymous one. Any record of
  "this member answered anonymously" would identify the author of a lone anonymous answer (kept
  under the threshold) to the database owner, and shrink the candidate set for the others.
- **A save and the levée never cross.** `submit_event_feedback()` holds a transaction-level
  advisory lock on the event, shared, while it checks the window and writes; the levée takes it
  exclusively before it reads the answers. Saves don't wait for each other; a save in flight
  commits first and is published, or the save waits for the levée and reads the marker. One save
  at a time per member and event (a second, exclusive advisory lock), so two first saves can't
  create two answers.
- **A save writes or locks no row a client can read.** PostgREST returns the system columns
  (`xmin`, `xmax`, `ctid`) to anyone who may read a row, the anon key included, and a row lock
  writes the locking transaction's id into `xmax`. A `FOR SHARE` on the event, or a foreign key's
  check (`FOR KEY SHARE` on the referenced row), would show anyone polling `events`, and admins
  polling the member's `profiles` and `user_parties` rows, who saved and when. So the lock is an
  advisory one, and the two tables have **no foreign key to `events`, `profiles` or
  `user_parties`**: the save checks the event and the party itself (events are never deleted), and
  `AFTER DELETE` triggers on `profiles` and `user_parties` do the `SET NULL`, the party one under
  the event's exclusive lock so that a save in flight from that party is cleared too. Advisory locks
  show only in `pg_locks`, which no API exposes.
- **An answer belongs to its author and its event, not to the party** (kept from the first design's
  review). Admins can change a `user_parties` row's owner or event, or delete it. The link's
  `author_id` and `event_id` are fixed at the first write (a trigger), `party_id` only records the
  registration and becomes null if it is deleted. So an admin who makes a party theirs answers as
  themselves and reads nothing of the previous owner's; moving or deleting parties neither moves
  nor removes an answer, and changes nothing in the admin's read. A hard-deleted profile nulls
  `author_id`: the answer stays, unattributed.
- **« Voir comme »** ([ADR 0025](./0025-voir-comme-read-only-impersonation.md)) runs in the member's
  real session. There `my_event_feedback()` returns `answer: null, answer_hidden: true` and the
  same window fields, whether the member has a named answer, an anonymous one or none; it doesn't
  run the levée (the session is read-only). `submit_event_feedback()` refuses the session before
  any other check, and the read-only trigger is on both tables. `event_feedback_answers()` is
  `admin_only` there (`is_admin()` is false in an impersonated session).
- **ADR 0024 exception.** [ADR 0024](./0024-no-hard-deletes.md) keeps rows instead of deleting
  them. The levée deletes the window rows of the anonymous answers and their links; the texts live
  on in the published rows. Nothing else deletes an answer: a deleted party, a soft-deleted account
  (`delete_my_account()`) and a hard-deleted profile leave it.

## Accepted limits

Not fixed, by the organiser's decision on #315:

- **The database owner can read everything while the window is open** (the link is in the
  database until the close). Direct connections, migrations and the dashboard's SQL editor run as
  the owner.
- **Logs.** Supabase request logs show who called `submit_event_feedback()` and when, not what was
  sent, for their retention (1 day on the free plan, 7 on Pro).
- **Backups.** The encrypted CI backup taken when a migration merges during an open window
  ([ADR 0014](./0014-ci-applies-migrations-on-merge.md), kept 90 days, readable only with the backup
  passphrase) holds the link. So do Supabase's own backups of that period, on a plan that has them.
  The tables aren't excluded from dumps.
- **The levée runs at the first call after the close date**, not at the stroke of midnight (no
  scheduler): the link lives until then. Archival runs it at once.
- **The texts themselves** may give their author away.
- **The candidate set.** The participants without a named answer are the candidates for the
  anonymous ones; the threshold of 3 counts answers, not people. An admin who registers accounts
  they control and has them answer anonymously can pad the count past 3 and narrow the candidates.
- **Changing the functions.** Anyone who changes them could capture authors; every change is a
  reviewed migration in the public repository.
- **Rare deadlocks.** The levée holds the event's lock through the rest of its update. An update
  that both closes an event and promotes its waiting list (`promote_waitlisted_for_event`, e.g. a
  raised `max_attendees`, the first update past the close date), racing an admin's party delete on
  that event, can deadlock; so can two account hard-deletes whose parties on the same events
  cascade in opposite order. Postgres aborts one of the two, and retrying it works.
- **Dead tuples and heap slots.** The window's rows and their earlier versions stay on disk until
  vacuum, readable only with superuser access to the storage. While the window is open, the owner
  can also see where the rows sit in the heap (`ctid`): an anonymous row between two named ones was
  written between them. That is owner-only and adds nothing to the request logs the owner already
  has; the levée's new rows don't keep those positions.

## Options considered

- **Link until the close, erased by the levée (chosen).** Members keep "one answer, editable from
  any device, switchable", and after the close nothing in the database ties an anonymous text to
  its author.
- **A permanent `author_id`, the admin's read leaving it out** (the first design). Admins couldn't
  read the author, but the database owner, a backup or a future function could, for good; and the
  live read let an admin match a new or changed anonymous answer with the member's other activity.
  Rejected by the organiser.
- **A client-held secret** (a key or token in the browser, a hash in the database). It still needs a
  "has answered" row per member, written at the same moment as the answer, so it protects no better
  during the window; it also breaks editing after a device loss or from another device. Rejected.
- **A scheduled levée (pg_cron)** at the close instant. Out of scope for #315; the first call after
  the close, or archival, is enough.

## Consequences

- Any new reader of these tables (an export, an Edge Function) is a new `SECURITY DEFINER`
  function that names its output, applies the close and the threshold, and is added to the RLS
  suite's list (« post-mortem feedback »), which fails when a function or view reads the tables
  without being listed.
- The member page (#316) shows, after the close, a named answer read-only and, without one, a
  message that covers both cases: no answer, or an anonymous one that can no longer be shown.
- The admin section (#317) shows nothing but the close date before the close, and the anonymous
  answers in the order the database returns them.
- The event form (#329) edits `feedback_days` and shows `feedback_closed_at`; it never writes the
  marker.
