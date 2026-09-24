# Going over capacity waitlists, it never blocks

When registrations exceed `max_attendees` (default 90), the registration is still accepted and simply
flagged `is_waitlisted`, with the message *"L'événement est malheureusement complet, mais vous serez
ajouté à la liste d'attente."* A hard refusal would send a friend away with nothing, and organisers
would rather see the full demand — people drop out every year, and the cottage's real limit is
negotiable in a way a database column is not.

## Consequences

- The decision is made in Postgres (`enforce_capacity_and_waitlist`) under
  `pg_advisory_xact_lock` per event, so two simultaneous registrations cannot both slip past the cap.
  The client's own capacity check is decorative and gets overwritten.
- Waitlisting is **all-or-nothing per party**: a party of four that straddles the cap goes entirely to
  the waitlist rather than being split. Splitting a family is worse than one extra manual decision.
- Nothing ever moves a party *off* the waitlist. Promotion when someone cancels is an unbuilt manual
  step, and the organisers need it — see
  [issue #32](https://github.com/YULmix/yulmix-la-bedaine/issues/32).
