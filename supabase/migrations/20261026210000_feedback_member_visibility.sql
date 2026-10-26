-- #341 (amends ADR 0029): a per-event switch for the members' post-mortem, off by default.
-- Off: a member can't read (my_event_feedback) or save (submit_event_feedback) on the event, the
-- database answers event_not_found as for an unknown event. Admins are unaffected, so they can test.
-- The switch touches neither the close, nor archival, nor the levée, nor any stored answer:
-- feedback_closed_at, event_feedback_window() and the close triggers don't read it.
ALTER TABLE public.events
    ADD COLUMN feedback_member_visible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.feedback_member_visible IS
    'Post-mortem (#341): whether members can see and answer it. Off by default, every existing event included; admins always can. Changes nothing about the close, archival or the anonymity release.';

-- Redefines private.event_feedback_check_event(), copied from 20261026043829_event_feedback.sql;
-- the only difference is the members' switch. It guards submit_event_feedback and
-- my_event_feedback (event_feedback_answers is admin-only and unaffected).
CREATE OR REPLACE FUNCTION private.event_feedback_check_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = p_event_id
                     AND (public.is_admin() OR (e.status <> 'DRAFT' AND e.feedback_member_visible))) THEN
        RAISE EXCEPTION USING MESSAGE = 'event_not_found', ERRCODE = 'P0002';
    END IF;
END;
$$;
