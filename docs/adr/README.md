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
| [0002](./0002-single-schema-file-no-migrations.md) | A single append-only `schema.sql` instead of migrations | accepted, should be revisited |
| [0003](./0003-pricing-as-a-pure-module.md) | Pricing lives in one pure, tested module | accepted |
| [0004](./0004-per-attendee-logistics-inside-attendees.md) | Per-person logistics live inside the `attendees` JSONB | accepted |
| [0005](./0005-waitlist-instead-of-blocking.md) | Over capacity waitlists, never blocks | accepted |
| [0006](./0006-french-values-in-payment-and-status-columns.md) | Payment status is stored in French | superseded by 0012 |
| [0007](./0007-selling-price-not-cost-drives-member-pricing.md) | The admin-set selling price, not the cost estimate, determines what members pay | accepted |
| [0008](./0008-archive-never-delete.md) | Events are archived, never deleted | accepted |
| [0009](./0009-french-ui-english-code.md) | French UI from one dictionary, English codebase | accepted |
| [0010](./0010-pricing-rules-and-logistics.md) | Refined pricing rules, individual logistics, and event lifecycle | accepted |
| [0011](./0011-feedback-loop-and-admin-controls.md) | Operational feedback loop, event safety, and communications | accepted |
| [0012](./0012-migrate-status-columns-to-english.md) | Migrate status/payment_status to English enum values | accepted |
