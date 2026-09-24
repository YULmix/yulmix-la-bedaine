# Schema changes are Supabase CLI migrations, applied by a person after review

`supabase/migrations/` is the source of truth for the database schema. This supersedes
[ADR 0002](./0002-single-schema-file-no-migrations.md): the single hand-edited `schema.sql` is gone,
and so is the practice of pasting SQL snippets into the Supabase SQL editor or running them with
`supabase db query --linked`.

The first migration, `20260924233313_baseline_live_schema.sql`, is a read-only dump of
**production** (`supabase db dump --linked`), not a cleaned-up `schema.sql`. Production was the
thing actually running, and `schema.sql` had drifted from it in both directions. The baseline copies
production faithfully, bugs included
([#49](https://github.com/YULmix/yulmix-la-bedaine/issues/49)). Fixes go in later migrations, never
into the baseline.

Every schema change is a new file from `supabase migration new <name>`, reviewed in a PR like any
other code, and applied to production **by a person** with `supabase db push` after the PR merges.
CI checks that the migrations apply cleanly to an empty local database. It does not push to
production: this database holds money and personal data for about ninety people, and a small team
gets more from a deliberate, watched `db push` than from saving one command.

**Status: accepted.**

## Consequences

- One source of truth that can be replayed. `supabase start` / `supabase db reset` builds a local
  database identical to production's schema, which unblocks the RLS test suite
  ([Development setup](../07-development-setup.md#running-the-rls-tests)).
- Production's migration history (`supabase_migrations.schema_migrations`) did not exist before
  this change. Before the first `db push`, someone must mark the baseline as already applied with
  `supabase migration repair --status applied 20260924233313 --linked`. Otherwise `db push` tries
  to re-create tables that already exist. See
  [Development setup → Database migrations](../07-development-setup.md#database-migrations).
- The old snippets (`fix_*.sql`, `migrate_status_payment_status_to_english.sql`) move to
  `supabase/legacy/` as a historical record. The CLI never runs them. Everything they did in
  production is already captured in the baseline, except the parts of the status migration that
  were never applied ([#49](https://github.com/YULmix/yulmix-la-bedaine/issues/49)).
- No file shows "the whole schema, current" any more. Read the baseline plus later migrations, or
  run `supabase db dump --local` against a local database built from them.
- Rollbacks are forward fixes: a new migration that undoes the previous one. The CLI has no "down"
  migrations, and for a schema this size that is fine.
