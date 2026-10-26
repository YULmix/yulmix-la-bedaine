-- #341 review fix: the members' switch must never delay the close or the levée.
-- A refused call rolls back, so a member call that raised event_not_found could not persist the
-- due-close. my_event_feedback() (the pass card's read, called on every pass load) now runs the
-- due-close FIRST and, with the switch off, returns a neutral "not yet open" payload instead of
-- raising; submit_event_feedback() still refuses (event_not_found) and, being a write, has nothing
-- to persist. The neutral payload is the same whatever the event's dates, close or answers.
--
-- private.event_feedback_check_exists is the original check_event body (20261026043829); check_event
-- (used by submit_event_feedback and event_feedback_answers) is that plus the switch, as in
-- 20261026210000. my_event_feedback is copied from 20261026043829; only the switch handling differs.
CREATE FUNCTION private.event_feedback_check_exists(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = p_event_id AND (e.status <> 'DRAFT' OR public.is_admin())) THEN
        RAISE EXCEPTION USING MESSAGE = 'event_not_found', ERRCODE = 'P0002';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.event_feedback_check_exists(uuid) FROM PUBLIC;

-- Whether the switch hides the post-mortem from the caller: not an admin, and the event's switch is off.
CREATE FUNCTION private.event_feedback_hidden_from_caller(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT NOT public.is_admin()
       AND NOT COALESCE((SELECT e.feedback_member_visible FROM public.events e WHERE e.id = p_event_id), false);
$$;
REVOKE ALL ON FUNCTION private.event_feedback_hidden_from_caller(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.event_feedback_check_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
    PERFORM private.event_feedback_check_exists(p_event_id);
    IF private.event_feedback_hidden_from_caller(p_event_id) THEN
        RAISE EXCEPTION USING MESSAGE = 'event_not_found', ERRCODE = 'P0002';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_event_feedback(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_window record;
    v_party record;
    v_hidden boolean := COALESCE(auth.jwt() ? 'impersonated_by', false);
    v_answer jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'not_authenticated', ERRCODE = '42501';
    END IF;
    PERFORM private.event_feedback_check_exists(p_event_id);
    IF NOT v_hidden THEN
        PERFORM private.close_event_feedback_if_due(p_event_id);
    END IF;

    -- The switch (#341): off, a member learns nothing (not the dates, the close, their answer).
    IF private.event_feedback_hidden_from_caller(p_event_id) THEN
        RETURN jsonb_build_object(
            'eligible', true, 'reason', NULL, 'window', 'not_yet', 'opens_on', NULL, 'closes_on', NULL,
            'closes_at', NULL, 'closed_at', NULL, 'answer', NULL, 'answer_hidden', v_hidden);
    END IF;

    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);
    SELECT * INTO v_party FROM private.event_feedback_party(p_event_id);

    IF NOT v_hidden AND public.is_account_active() THEN
        SELECT jsonb_build_object(
                   'answers', private.event_feedback_answers_of(f),
                   'is_anonymous', f.is_anonymous,
                   'created_at', a.created_at,
                   'updated_at', a.updated_at)
        INTO v_answer
        FROM public.event_feedback_authors a
        JOIN public.event_feedback f ON f.id = a.feedback_id
        WHERE a.event_id = p_event_id AND a.author_id = auth.uid();
    END IF;

    RETURN jsonb_build_object(
        'eligible', v_party.reason IS NULL,
        'reason', v_party.reason,
        'window', v_window.state,
        'opens_on', v_window.opens_on,
        'closes_on', v_window.closes_on,
        'closes_at', v_window.closes_at,
        'closed_at', v_window.closed_at,
        'answer', v_answer,
        'answer_hidden', v_hidden);
END;
$$;
