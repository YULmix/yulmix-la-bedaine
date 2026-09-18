# Supabase is the only backend

The app is a static React SPA that talks to Supabase Postgres directly from the browser using the
public anon key; there is no API layer, serverless function or server of our own. For a volunteer
project coordinating one weekend a year for ninety friends, the operational cost of a backend
(hosting, deploys, secrets, on-call) is not worth paying, and Supabase supplies OAuth, a database,
realtime and row-level authorisation out of the box.

## Consequences

- **Every rule that must not be bypassed has to live in Postgres** — as a constraint, trigger, RLS
  policy or `SECURITY DEFINER` function. A check written only in React is a UX affordance, not
  enforcement. This is the single most important thing to internalise before changing anything.
- Business logic gets written twice when it must be both interactive and trustworthy: once in JS for
  the live form total, once in SQL for the authoritative value.
- The anon key is public. Security rests entirely on RLS being correct, which is why
  `src/__tests__/rlsPolicies.test.js` matters more than any other test.
- Anything genuinely server-side (sending email, scheduled jobs) will be the first thing to break
  this decision. When that happens — probably for confirmation emails — write a new ADR rather than
  quietly adding a function.
