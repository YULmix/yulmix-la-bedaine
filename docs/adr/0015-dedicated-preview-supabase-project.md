# A dedicated free-tier Supabase project for Vercel Preview deployments

Fixes [issue #51](https://github.com/YULmix/yulmix-la-bedaine/issues/51): every Vercel Preview
deployment used to point at the **production** Supabase project — `VITE_SUPABASE_URL` was
identical in both environments, and `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS entirely) was also
exposed to Preview, not just Production. Any preview build, from any branch, before review, had
unrestricted access to real registrations and payments.

**Constraint: this project runs on $0 across Vercel, Supabase, and GitHub.** That ruled out
[Supabase branching](https://supabase.com/docs/guides/deployment/branching) (issue #51's "most
correct fix" option) outright — it needs the Pro plan or above, and even there a persistent branch
costs roughly $9.70/month on top of it, with no free tier at all.

## Decision

A second, free-tier Supabase project (`YULmix - La Bedaine (Preview)`, ref `uacfrldoiixfstigosqv`)
exists solely for Vercel's `Preview` environment. It has:

- The same schema as production, from replaying `supabase/migrations/` against it directly
  (`supabase db push --project-ref ... --password ...`) — not `supabase link`, so the CLI's linked
  project (production) is never at risk of being the accidental target.
- `supabase/seed.sql`'s fake `member@test.local` / `admin@test.local` users (`supabase db push
  --include-seed`), so preview builds can still exercise the member/admin RLS boundary without any
  real data.
- Its own anon key and service-role key, set as Vercel `Preview`-scoped env vars
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). The service-role key
  being exposed to Preview is no longer a production-data risk — it can only bypass RLS on this
  empty, fake-data project.

A stray free-tier project (`Kill this`, inactive) that predated this work was deleted to stay
within the org's free-tier project-count limit.

**Status: accepted.**

## Consequences

- **Migrations must be pushed to the Preview project by hand, for now.** Unlike production
  (ADR 0014), there is no CI step that replays new `supabase/migrations/` files against
  `uacfrldoiixfstigosqv` on merge. A migration that lands in production without also being pushed
  here leaves Preview's schema stale, and a preview build touching the drifted table/column will
  fail in ways that don't reproduce in production. Until this is automated, whoever merges a
  migration PR should also run `supabase db push --project-ref uacfrldoiixfstigosqv` (get the
  project's DB password from the Supabase dashboard — it isn't stored in this repo).
- Preview's fake data (two seeded users, no events/registrations) means preview builds can't
  exercise scenarios that need realistic volume or historical data. That's an acceptable trade for
  no longer touching production.
- The Preview project is on the free tier and will pause after a week of inactivity, the same as
  any other free Supabase project. A paused project makes the next preview build fail until it's
  resumed from the dashboard (or by pinging its API, which auto-resumes it) — worth knowing if
  preview builds start failing after a quiet week.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` differ between `Production` and `Preview` in
  Vercel's dashboard now — this is intentional, don't "fix" it by resyncing them.
