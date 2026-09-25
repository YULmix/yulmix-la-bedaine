# CI applies migrations to production on merge, after a backup

Supersedes the "applied **by a person**" part of [ADR 0013](./0013-supabase-migrations.md).
Everything else in 0013 still holds: `supabase/migrations/` is the source of truth, and every
schema change is a reviewed migration file.

When a push to `main` brings new files under `supabase/migrations/`,
`.github/workflows/deploy.yml` does, in order: build and test, replay the migrations on an empty
database, dump production (roles, schema, data) into an encrypted artifact, `supabase db push`, and
only then deploy the frontend to Vercel. The gate is the existing PR review: a migration reaches
production when its PR is approved and merged, with no second approval step. Pushes that touch no
migration skip all of the database jobs.

The manual push in 0013 turned out to be the weak point, not a safeguard. The frontend deploys the
moment a PR merges, so code that needs a new column was live before anyone ran `db push`, and a
forgotten push was a silent outage. A person also had to hold production credentials on their own
machine and remember a sequence of commands. Running the same command in CI, right after a fresh
backup and before the frontend that needs it, removes both problems.

**Fix forward, no down-migrations.** We don't write "down" scripts and the CLI can't run them.
If a migration turns out wrong after it's applied, the fix is a new migration, reviewed and merged
like any other. The backup artifact taken just before the push is the safety net for the case a
forward fix can't cover (lost data): restore the rows from it, again through a migration or a
one-off reviewed script.

**Status: accepted.**

## Consequences

- Merging a migration PR changes production. Review it as such. Squawk comments on the PR about
  statements that break the running app (dropped or renamed columns, `NOT NULL` without a default),
  and blocks the merge until they are removed or explicitly ignored with `-- squawk-ignore <rule>`.
- A failed `db push` blocks that run's Vercel deploy, so no code that needs the missing schema
  ships. Each migration file runs in its own transaction, so the failed file leaves no partial
  change. The next push to `main` retries whatever is still pending, because change detection
  compares against the last fully successful run, not the previous commit.
- A migration whose push failed was never applied, so it may be fixed in place. One that was
  applied must never be edited.
- The frontend deploys a minute or two after the schema changes. Removing or renaming something
  the live frontend still reads needs two PRs: first stop using it, then drop it.
- The workflow needs two secrets, `SUPABASE_ACCESS_TOKEN` and `SUPABASE_BACKUP_PASSPHRASE`
  (setup in the header of `deploy.yml`). Backups contain personal data and this repository is
  public, so they are encrypted with the passphrase before upload and kept for 90 days.
- Running `supabase db push` by hand is now for recovery only (see
  [Development setup → Database migrations](../07-development-setup.md#database-migrations)).
