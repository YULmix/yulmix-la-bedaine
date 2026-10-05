# Decision records

Short notes on *why* the system is shaped the way it is, so nobody has to re-derive it or
"fix" something deliberate. One to three sentences is a complete ADR — the value is in recording
*that* a decision was made and *why*, not in filling out sections.

These were written **retroactively** in September 2026 by reading the code, the schema and
`docs/Bedaine App - Requirements.md`. They record decisions that are visibly embodied in the
system; where the reasoning is inferred rather than documented, the ADR says so. Correct any that
misread the original intent — that is more valuable than leaving them unchallenged.

| # | Decision | Status |
|---|---|---|
| [0001](./0001-supabase-as-the-only-backend.md) | Supabase is the only backend; the SPA talks to Postgres directly | accepted |
| [0002](./0002-single-schema-file-no-migrations.md) | A single append-only `schema.sql` instead of migrations | superseded by 0013 |
| [0003](./0003-pricing-as-a-pure-module.md) | Pricing lives in one pure, tested module | accepted |
| [0004](./0004-per-attendee-logistics-inside-attendees.md) | Per-person logistics live inside the `attendees` JSONB | superseded by 0018 |
| [0005](./0005-waitlist-instead-of-blocking.md) | Over capacity waitlists, never blocks | accepted |
| [0006](./0006-french-values-in-payment-and-status-columns.md) | Payment status is stored in French | superseded by 0012 |
| [0007](./0007-selling-price-not-cost-drives-member-pricing.md) | The admin-set selling price, not the cost estimate, determines what members pay | accepted; repricing updated by 0017 |
| [0008](./0008-archive-never-delete.md) | Events are archived, never deleted | accepted |
| [0009](./0009-french-ui-english-code.md) | French UI from one dictionary, English codebase | accepted |
| [0010](./0010-pricing-rules-and-logistics.md) | Refined pricing rules, individual logistics, and event lifecycle | accepted |
| [0011](./0011-feedback-loop-and-admin-controls.md) | Operational feedback loop, event safety, and communications | accepted |
| [0012](./0012-migrate-status-columns-to-english.md) | Migrate status/payment_status to English enum values | accepted |
| [0013](./0013-supabase-migrations.md) | Schema changes are Supabase CLI migrations, applied by a person after review | accepted; "by a person" superseded by 0014 |
| [0014](./0014-ci-applies-migrations-on-merge.md) | CI applies migrations to production on merge, after an encrypted backup; fix forward | accepted |
| [0015](./0015-dedicated-preview-supabase-project.md) | A dedicated free-tier Supabase project for Vercel Preview, instead of sharing production | accepted |
| [0016](./0016-edge-function-for-transactional-email.md) | Transactional email is sent by one Supabase Edge Function, triggered from Postgres | accepted |
| [0017](./0017-lock-price-per-registration.md) | A registration keeps the base price and ratio it was made at; a price change only affects new ones | accepted; reverses the repricing of #32/#109 |
| [0018](./0018-attendees-in-their-own-table.md) | Attendees live in their own table, referenced by foreign key; no derived copies on `user_parties` | accepted, implemented (#126); supersedes 0004 |
| [0019](./0019-shared-venues.md) | Venues (and their locations and places) are shared by events; per-edition differences are overrides | accepted, implemented (#145); archived events refined by 0020 |
| [0020](./0020-freeze-archived-event-layout.md) | Archiving an event copies its venue into a frozen venue only it uses, so past editions keep their layout | accepted, implemented (#148) |
| [0021](./0021-database-errors-are-codes.md) | Database errors are English codes with JSON parameters; the app maps them to French and never shows a raw message | accepted, implemented (#102) |
| [0022](./0022-admin-navigation-and-page-widths.md) | Admin navigation: seven flat sections (sidebar on desktop, bottom bar + « Plus » on phones), one switcher per level, two page widths, path URLs | accepted (#191); implementation in progress |
| [0023](./0023-edition-roles.md) | Edition roles: a ladder Member < Comité < Organisateur (per edition) < Admin (per account), enforced by `edition_role(event_id)` | accepted (#217); not implemented |
| [0024](./0024-no-hard-deletes.md) | No hard deletes: removed rows get a `deleted_at`, hidden by a restrictive policy and filtered in every definer reader; attendees (#237) first | accepted, implemented for attendees (#237); generalises 0008 |
| [0025](./0025-voir-comme-read-only-impersonation.md) | « Voir comme »: an admin views the app in a member's real session (magic link + custom access token hook), read-only by a statement trigger on every table, 30 minutes, non-admin targets | accepted (#106); database side implemented (#265) |
| [0026](./0026-comite-does-not-see-finances.md) | Comité doesn't see finances (amounts, payment status): it reads its edition's parties through `edition_parties()`, without them, and no longer reads `user_parties` nor the change history | accepted, implemented (#290); amends 0023 |
