-- Fixes #45 (repo hygiene): the baseline migration carried forward
-- `GRANT ALL ON SCHEMA "public" TO "anon"/"authenticated"` from production. `ALL` on a schema is
-- USAGE + CREATE — so, in addition to being able to see/call the objects already explicitly
-- granted to them per-table (unaffected by this migration), both client-facing roles can create
-- new objects directly in the public schema. That's broader than either role needs: they only
-- ever need USAGE (to reach the tables/functions this project explicitly grants them), never
-- CREATE. `service_role` is left untouched — it's the trusted server-side key and already
-- bypasses RLS.
--
-- This does not change access to any existing table or function: those come from the per-table/
-- per-function GRANTs already present in the baseline migration, not from this schema-level one.
-- A new table still needs its own explicit GRANT (and RLS policies) in the migration that adds
-- it — see docs/06-security-and-rls.md.

REVOKE CREATE ON SCHEMA "public" FROM "anon";
REVOKE CREATE ON SCHEMA "public" FROM "authenticated";
