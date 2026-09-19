# Per-person logistics live inside the attendees JSONB

Sleeping preference, bed reason and dietary needs are stored per attendee, as fields on each object
in `user_parties.attendees`, while the top-level `logistics` column keeps only party-wide things
(transport, volunteering, and an admin-assigned sleeping spot). The requirements originally put
logistics at the party level and were explicitly revised: a couple bringing two kids may need one
bed for health reasons and the floor for everyone else, and one vegetarian in a party of five has to
be visible to whoever buys the food.

## Consequences

- No extra table and no join for what is always read and written as a whole party — the registration
  form loads and saves one row.
- Nothing validates the shape. An attendee object is a contract between the form, the counts trigger
  and every admin screen, enforced only by convention; the `tier` vs `type`/`participation`
  divergence is exactly this contract breaking silently.
- Party-level `logistics.sleeping` is now a *summary* copied from the first attendee, which is why
  the admin dietary and sleeping breakdowns count parties rather than people. Aggregates should read
  `attendees` directly.
- `logistics.sleeping.assigned` stays party-level and admin-write-only: the member's preference is a
  request, the assignment is the organiser's answer.
