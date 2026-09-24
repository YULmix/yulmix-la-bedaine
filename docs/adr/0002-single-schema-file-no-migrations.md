# A single append-only schema.sql instead of migrations

**Superseded by [ADR 0013](./0013-supabase-migrations.md)** (September 2026): the schema now lives
in `supabase/migrations/`, and `supabase/schema.sql` has been removed. What follows is kept as
the record of why that change was needed.

All DDL lived in one file, `supabase/schema.sql`. People appended to it as the schema grew and
applied it by pasting it into the Supabase SQL editor. `.clinerules` required that any edit to it
also produce an isolated `ALTER` snippet for the live database. This was the fastest path for one
person prompting an agent, and it avoided setting up the Supabase CLI.

**Status: superseded.** It had already cost us.

## Consequences

- **The file and the live database provably diverged.** `admin_set_is_admin` in the file was
  syntactically invalid (`AS $` with no closing tag), so the file could not be applied at all.
  Production had the repaired function from `fix_admin_function.sql`, and the file still had the
  broken one when it was removed. When the live schema was finally dumped for ADR 0013, it also
  showed that the French→English status migration had been applied only halfway
  ([#49](https://github.com/YULmix/yulmix-la-bedaine/issues/49)). Nothing had told anyone.
- The file was not idempotent (bare `CREATE TABLE`/`CREATE POLICY` for most objects), so it only
  described building a database from nothing.
- There was no way to review a schema change as a diff, no way to roll one back, and no way to
  bring up a local or staging database that matched production. That is also why the RLS test
  suite has never run.
