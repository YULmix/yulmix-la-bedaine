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

- Live production data needed `supabase/migrate_status_payment_status_to_english.sql` (now in
  `supabase/legacy/`) run once against the real database. As of 2026-09-24 only part of it had
  been applied. The data and CHECK constraints are English, but the capacity trigger, the
  member-update policy and the column defaults still use the French values. The rest is tracked in
  [#49](https://github.com/YULmix/yulmix-la-bedaine/issues/49) and will ship as a migration
  ([ADR 0013](./0013-supabase-migrations.md)).
- Anything outside this repo that reads `user_parties.status`/`payment_status` directly (a saved
  Supabase query, an external report) will see the new English values and needs updating too.
