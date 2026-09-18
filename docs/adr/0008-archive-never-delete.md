# Events are archived, never deleted

`public.events` has a `BEFORE DELETE` trigger that raises unconditionally — no event can be removed,
by anyone, including admins and including through the API. Events move `DRAFT → ACTIVE → ARCHIVED`
instead, and a partial unique index guarantees at most one is active at a time. The group's history
across many years is the thing the spreadsheet kept badly and the app is meant to keep well; an
accidental delete would take everyone's past registrations with it via the cascade.

## Consequences

- The `user_event_history` view, and any "how many weekends have you come to?" feature, can rely on
  history being intact.
- Test and mistake events accumulate as `DRAFT`/`ARCHIVED` rows forever. Acceptable at a handful of
  events per decade; if it becomes noise, add a `hidden` flag rather than weakening the trigger.
- Re-activating an archived event is allowed (and specified as something to support), gated only by
  the one-active-event index.
- Registrations deliberately do **not** share this protection at the policy level: the intent is that
  unregistering marks a record cancelled, but an RLS DELETE policy for members still exists. That is
  an inconsistency to close, not a second decision.
