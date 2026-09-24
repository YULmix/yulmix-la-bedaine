# Migrate status/payment_status to English enum values

`user_parties.status` and `user_parties.payment_status` are now `'registered'|'pending'|'cancelled'`
and `'unpaid'|'paid'`, matching `events.status`. This supersedes [ADR 0006](./0006-french-values-in-payment-and-status-columns.md),
which accepted the original French values as a production-data fact rather than a deliberate choice.

French labels are looked up once, from the new value, via `getRegistrationStatusLabel` /
`getPaymentStatusLabel` / `getPaymentStatusShortLabel` in `src/lib/registrationOptions.js` — the same
pattern already used for every other enum-like field (tier, accommodation, dietary, ...). No code
compares against a raw French literal anymore.

**Status: accepted.**

## Consequences

- Live production data needs `supabase/migrate_status_payment_status_to_english.sql` run once against
  the real database; `supabase/schema.sql` reflects the new values for fresh installs only.
- Anything outside this repo that reads `user_parties.status`/`payment_status` directly (a saved
  Supabase query, an external report) will see the new English values and needs updating too.
