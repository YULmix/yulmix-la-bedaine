# Payment status is stored in French

**Superseded by [ADR 0012](./0012-migrate-status-columns-to-english.md).** The values described below
are the pre-migration state, kept for history.

`user_parties.payment_status` was `CHECK (payment_status IN ('Impayé', 'Payé'))`, and `status` held
`'Enregistré'`. The French display value was the stored value, so those two columns could be rendered
without translation.

**Status: superseded.** It contradicted the project's own rule that database entities are English and
that raw enums are never rendered — and it was inconsistent with `events.status`, which correctly
stores `DRAFT|ACTIVE|ARCHIVED` and maps to French at the edge.

## Consequences

- Comparisons are littered with accented string literals in both JS and SQL (`=== 'Payé'`,
  `status IN ('Enregistré','En attente')`), which is precisely the code that breaks when a file gets
  saved as Windows-1252 instead of UTF-8.
- Changing the French wording would mean a data migration.
- New status-like columns should follow `events.status`: English constants in the database, French in
  `src/locales/fr.json`. Do not extend this pattern.
