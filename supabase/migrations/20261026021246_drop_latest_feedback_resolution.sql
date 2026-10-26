-- #308: the "refresh the page" banner is withdrawn (ADR 0011, point 1): resolving a feedback is
-- not tied to a release. Nothing calls this RPC any more. The is_resolved / resolved_at columns
-- and the admin-only enforce_feedback_resolution_admin_only trigger stay.
drop function if exists public.get_latest_feedback_resolution();
