# Anonymous post-mortem answers: nothing before the close, then the « levée » erases the link

After an event, the organisers collect a post-mortem, the « bilan »: one free text per category
from each member registered on it, named or anonymous, read by account admins only
([issue #315](https://github.com/YULmix/yulmix-la-bedaine/issues/315), epic #309). The organiser
asked for **true anonymity**: "there should be ZERO ways to associate those comments with their
author", « Voir comme » included. An admin reads every registration, profile and change history,
and can open a member's session; so the author link can't just be hidden on screen, and it can't
stay in the database for good either. **While the window is open, each answer has its author link,
in tables no client role can read, and admins read no answer (since #345, counts only). At the close, one irreversible
step, the « levée », publishes the answers and erases the link of every anonymous one.**

**Status: accepted** (October 2026), amended by #354 (items, signed or private, read live:
see [the amendment](#amendment-354-items-signed-or-private-read-live), which supersedes « nothing
before the close », the threshold of 3 answers and #345's own-answer exclusion). Implemented by #315: migration
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
  Note over DB: opens on the event's first day (Toronto, 00:00)
  M->>DB: submit_event_feedback() (window open)
  Note over DB: event_feedback + event_feedback_authors
  A->>DB: event_feedback_answers()
  DB-->>A: closed: false, no answer
  A->>DB: event_feedback_counts() (amendment #345)
  DB-->>A: signed count; anonymous count only if at least 3
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
  them, nothing embeds them, they aren't in the Realtime publication. The `SECURITY DEFINER`
  functions below (three in #315, a fourth for the counts in #345) are the only way in, and each
  names its output.
- **The window and the close.** It opens on the event's first day (Toronto day of the
  start, from 00:00; amended 2026-10-26, #339, was the day after the last day). It closes at the end of the Toronto day "last day +
  `events.feedback_days`" (default 14, from 1 to 365), or at archival if that comes first. A DRAFT
  event, or one without a start date, never opens and never closes by date.
- **The close is final.** `events.feedback_closed_at` is set once, by the levée, and never cleared;
  a trigger refuses any other write to it, by an admin or the database owner. Once set, un-archiving
  the event ([ADR 0008](./0008-archive-never-delete.md) allows it) or a new
  `feedback_days` doesn't reopen anything: every function reads the marker first. Before the close an
  admin may change `feedback_days`; a value that puts the close in the past closes it at once. A
  close date that passed is final even before the levée has run: any update of the event then runs
  it first.
- **No answer before the close, only counts.** `event_feedback_answers()` returns `closed: false`,
  the close date, and `named`/`anonymous` null: no answer, and nothing in it changes when a member
  writes. Who answered isn't readable by an admin by any path. Since #345 an admin reads *how many*
  answers there are through `event_feedback_counts()`, under the threshold rule (see the amendment
  « counts » below); amended 2026-10-26, was « no count ». After the close, named answers carry their
  author (id, party, name, email) and times; anonymous answers carry their texts only.
- **The levée.** `private.event_feedback_levee()` runs once per event, in the `BEFORE UPDATE`
  trigger on `events` (holding the event's advisory lock exclusively, see below), in one
  transaction with setting the marker: at
  archival, at any update of the event once its close date has passed (or that puts it there), and,
  through a no-op update, at the first call of any of those functions after the close date. It
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
  Before the close the counts (#345) make it a live probe: the threshold leaves out only the
  calling admin's own answer, so with two other accounts they control answering anonymously,
  every real anonymous answer from the first on shows as a step (their 2 plus 1 real make 3 others), which
  they can match with what else they see.
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
- The admin section (#317) shows no answer before the close, only the close date and (since #345)
  the counts of `event_feedback_counts()`; after it, the anonymous answers in the order the database
  returns them.
- The event form (#329) edits `feedback_days` and shows `feedback_closed_at`; it never writes the
  marker.

## Amendment (#341): the members' switch

`events.feedback_member_visible` (`NOT NULL DEFAULT false`, so off for every existing event) is the
organiser's switch, set in the event form's « Calendrier » fieldset. Off, a member can neither read
nor save on the event. Reading (`my_event_feedback`, which the pass card calls on every pass load)
returns one neutral payload, « not yet open », with no date, close or answer, so the pass shows no
card and the page says the bilan isn't open. Saving (`submit_event_feedback`, and the admin read)
goes through `private.event_feedback_check_event`, which answers `event_not_found` as for an unknown
event. Admins are unaffected, to test: they read, save and edit as usual, with the same registration
requirement as a member (an admin answers for an event they are registered to). A DRAFT event stays
unknown to a member whatever the switch.

The switch is only a visibility gate. The window, `feedback_closed_at`, the close by date or archival
and the levée don't read it, so turning it off never closes the feedback, releases anonymous answers
or loses one. It doesn't delay the close either: a refused call is rolled back and could not
persist the due-close, so `my_event_feedback` runs it before looking at the switch and then answers
neutrally (the refused save writes nothing and relies on that read, an admin call or an event
update). The close still comes with the first of those after the close date.

Answers an admin wrote while the switch was off are real rows: the close publishes them with the
members' (named with their author, anonymous in the pool), so test answers are visible in the admin
« Bilan » like any other.

## Amendment (#345): the counts, before the close

The organiser asked (2026-10-26) to see, before the close, how many answers came in, signed and
anonymous, against the registrations that may answer. He accepted it as a **deliberate, small
loosening** of « nothing before the close »: admins learn *how many*, never *which*, *who* or
*when*. Migration `20261026230000_feedback_counts.sql`.

- **`event_feedback_counts(event)`**, a `SECURITY DEFINER` function, account admins only
  (`admin_only`: not Comité, Organisateur nor « Voir comme », where `is_admin()` is false). Same
  doors as `event_feedback_answers()`: the event check (`event_not_found`), then the due-close,
  which may run the levée. It returns `{ closed, closes_on, eligible, signed, anonymous, total }`,
  before and after the close, and nothing else: no text, author, id, time, ordering or history.
- **Signed** is exact from the first answer. **Anonymous** is shown only when there are at least 3
  anonymous answers **besides the caller's own**, the threshold above; otherwise it is `null` (the
  UI says « moins de 3 »), the same value for 0, 1 and 2 others. Once shown, the number is every
  anonymous answer, the caller's own included, and `total` is signed + that number: both count
  the whole event, and an admin knows their own answer anyway. Before the close the caller's own
  anonymous answer is found by its author link; this keeps an admin registered on the event from
  probing the threshold with their own answer (save anonymously, reload, see whether it flips,
  switch back, repeat; #345 review). After the close no anonymous answer has a link any more, so
  the threshold is on all of them, exactly as in `event_feedback_answers()`, and the counts agree
  with it (an anonymous count exactly when the anonymous texts are shown).
- **The total never reveals an anonymous count under 3.** `total` (signed + anonymous) is `null`
  whenever `anonymous` is, since total − signed would give it; so is any rate over `eligible`.
- **Eligible** is the denominator: the event's registrations that are neither cancelled nor on the
  waiting list (the member's eligibility; a deleted account's registrations are cancelled). It was
  already readable by admins.
- The function only reads: it locks no row a client can read (and takes no advisory lock), so the
  save's and the levée's locking are unchanged. It is in the RLS suite's list of the tables' readers.

### Accepted limit (counts)

The counts are read on load only (no Realtime, no polling), but an admin who reloads sees each
change as a step, and the organiser accepted it:

- once there are at least 3 anonymous answers, each new anonymous answer (anonymous +1);
- at any count, a switch from signed to anonymous (signed −1, anonymous +1 once shown), and back.
  Below the threshold the signed count still drops, which tells the admin that one more anonymous
  answer exists, though not whose;
- a step from a shown count to `null`: an admin who read 3 and, on a reload, reads `null` with
  signed +1 knows there are now exactly 2 others. `null` hides 0, 1 and 2 only from an admin with
  no earlier reading to compare it with; across reloads, the steps above can be followed below the
  threshold too;
- each new signed answer (signed +1), which was never secret after the close.

Matched with what else an admin sees (who just logged in, a message from a member), a step can
narrow who wrote an anonymous answer; that is the price of the counts. No timestamp is returned, so
nothing tells when a step happened beyond the admin's own reloads.

## Amendment (#354): items, signed or private, read live

The organiser changed plans (2026-10-26): "anonymity is per response not all or nothing", and
admins read the comments as they come in rather than after the close. This amendment
**supersedes**, for everything below, « nothing before the close », the threshold of 3 *answers*
and #345's exclusion of the caller's own answer; the levée, the close, the members' switch, the
closed tables, the locks and « Voir comme » stay as decided above. Migration
`20261027000000_feedback_items.sql`.

```mermaid
sequenceDiagram
  participant M as Member
  participant DB as Database
  participant A as Admin
  M->>DB: submit_event_feedback(items) (window open)
  Note over DB: event_feedback_items + event_feedback_item_authors
  A->>DB: event_feedback_answers()
  DB-->>A: signed items with their author, no time; private: [] (not released)
  Note over DB: a save brings the 3rd different private author: release marker, for good
  A->>DB: event_feedback_answers()
  DB-->>A: signed items; private texts only, random order
  Note over DB: close: levée re-inserts private items (fresh ids), deletes their links
  M->>DB: my_event_feedback()
  DB-->>M: own signed items only
```

- **A retour is made of items.** One row per item in `event_feedback_items` (`id` random,
  `event_id`, `category` among the eight, `body` non-blank, at most 5000 characters,
  `is_private`), nothing about who or when. The link is in `event_feedback_item_authors`
  (`item_id`, `event_id`, `category`, `is_private`, `author_id`, `party_id`, `created_at`,
  `updated_at`), `UNIQUE (event_id, author_id, category, is_private)`: **at most one signed and
  one private item per member, category and event**. The link's composite foreign key carries the
  item's category and kind, so the two can't disagree. Both tables keep the properties above (RLS
  on, no policy, no client privilege, no foreign key to a client-readable row). An item's event,
  category and kind are fixed; switching kind is a delete and a new item.
- **The save sets the member's whole set.** `submit_event_feedback(event, items)` with
  `items = [{ category, private, text }]` (`private` false when missing: **signed by default**).
  A pair left out is deleted, its link with it; a kept pair keeps its item id (its text is
  updated); a blank text is no item; at least one item is required (`event_feedback_empty`); a
  duplicate pair is refused (`event_feedback_duplicate {category, private}`). Same doors, order of
  checks and advisory locks as before. Members edit or delete their items, signed or private,
  until the close, after the release too. ADR 0024 exception, widened: a member's save deletes the
  items they leave out.
- **Signed items are read live**, by account admins, before and after the close:
  `event_feedback_answers()` returns `signed: [{ category, text, author: { id, party, name, email } }]`,
  in category order then by author name, **with no time** (and no order that follows one).
- **Private items are released at 3 different authors, for good.** When a save makes the event's
  count of *distinct* authors of private items reach 3 (any category, anyone, admins included),
  it inserts the event's row in `private.event_feedback_releases`. From then on
  `event_feedback_answers()` returns `private: [{ category, text }]` in random (id) order, even if
  authors later delete theirs; before, `private: []`, the same for 0, 1 or 2 authors. One member's
  three private items don't release themselves. The marker has **no time** and **no client
  privilege** (not a column of `events`, which every client reads with its `xmin`/`xmax`), and its
  insert writes no client-readable row. Two saves that bring the 2nd and the 3rd author at once
  can't both miss each other: the saves with a private item take an exclusive advisory lock on the
  event's release before counting, so the second one counts the first's committed items. Until the
  release, two saves with a private item on the same event therefore wait for each other's commit
  (milliseconds; other saves, and all saves after the release, still don't). An event never
  released before the close stays hidden for good.
- **The counts** (`event_feedback_counts()`): `{ closed, closes_on, eligible, signed_members,
  released, categories: [{ category, signed, private }], signed_total, private_total }`.
  `signed_members` is the members with at least one signed item; every private number is null
  until the release. No text, author, id, time or order.
- **The member's read** (`my_event_feedback()`): `items: [{ category, private, text }]`, the
  member's own, private ones included, while the window is open; after the close their signed
  ones only (a private item has no author any more). « Voir comme » and the switch off: `items: []`
  and, in « Voir comme », `answer_hidden: true`, whatever the member wrote.
- **The levée** re-inserts every private item with a fresh random id, in random order (the event,
  category and text only), and deletes its window row and link; signed items keep their link. It
  doesn't touch the release marker.
- **Existing answers were converted as they were** (production never showed the post-mortem to
  members): each non-null category text of an answer became one item of its kind (named → signed,
  anonymous → private), with the answer's link (author, party, times) when it still had one. An
  event with 3 or more anonymous answers is released (one answer was one author). The one-answer
  tables `event_feedback` and `event_feedback_authors` are dropped.

### Accepted limits (items)

Accepted by the organiser (2026-10-26), on top of the limits above, which still hold for the
private items until the close:

- **An admin can be one of the 3.** Anyone counts toward the release, an admin registered on the
  edition included, so an admin can complete it with their own private item, or with accounts they
  control: the release then shows the one or two real authors' texts.
- **Reloading shows steps.** An admin who reloads sees a signed item appear, change or disappear,
  the release happen (`released` turns true when the 3rd private author saved), and, once released,
  a private item appear, change or disappear, and the counts move with them. Matched with what
  else they see, a step can narrow who wrote a private item. No time is ever returned.
- **Signed and private side by side.** A member with a signed and a private item in the same
  category is one of the signed authors of that category; the private text may read like the
  signed one. Switching an item's kind deletes it and adds the other: once released, an admin who
  reloads sees one disappear as the other appears.
- **The candidate set** of a private item is every member with access to the form, and since the
  threshold counts authors, 3 private texts come from at least 3 people.
