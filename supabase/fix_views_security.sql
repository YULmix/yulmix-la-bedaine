-- Close the RLS bypass through the two SECURITY DEFINER views.
-- Run this script in the Supabase SQL Editor (project ceacurlofmasyvhsoska). Idempotent.
--
-- Problem (verified 2026-09-18 on the live DB): both views ran with their owner's rights, so RLS on
-- profiles / user_parties / events did not apply. A signed-in non-admin saw every member's email,
-- name, amount owed and payment status through user_event_history, and could read every registration
-- through registration_summary_view. `authenticated` also held INSERT/UPDATE/DELETE/TRUNCATE on both.
-- See docs/11-live-environment.md.

-- 1. registration_summary_view is referenced by nothing in src/. Drop it.
--    Rollback: recreate from the definition kept in git at a2cec16^:supabase/schema.sql (line 331),
--    then apply step 2's security_invoker option and step 3's grants to it.
DROP VIEW IF EXISTS public.registration_summary_view;

-- 2. user_event_history is used by the admin screen (src/views/AdminView.jsx:348). Run it with the
--    CALLER's rights so the existing RLS policies apply: admins still see everything (their policies
--    pass via is_admin()), members only see their own rows.
ALTER VIEW public.user_event_history SET (security_invoker = true);

-- 3. A read-only view should only be readable, and only by signed-in users.
REVOKE ALL ON public.user_event_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_event_history TO authenticated;
