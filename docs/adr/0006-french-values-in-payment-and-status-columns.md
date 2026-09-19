# Payment status is stored in French

`user_parties.payment_status` is `CHECK (payment_status IN ('Impayé', 'Payé'))`, and `status` holds
`'Enregistré'`. The French display value is the stored value, so those two columns can be rendered
without translation.

**Status: accepted (it is in production data), regretted.** It contradicts the project's own rule
that database entities are English and that raw enums are never rendered — and it is inconsistent
with `events.status`, which correctly stores `DRAFT|ACTIVE|ARCHIVED` and maps to French at the edge.

## Consequences

- Comparisons are littered with accented string literals in both JS and SQL (`=== 'Payé'`,
  `status IN ('Enregistré','En attente')`), which is precisely the code that breaks when a file gets
  saved as Windows-1252 instead of UTF-8.
- Changing the French wording would mean a data migration.
- New status-like columns should follow `events.status`: English constants in the database, French in
  `src/locales/fr.json`. Do not extend this pattern.
