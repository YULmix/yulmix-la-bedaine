-- #345 (amends ADR 0029): how many post-mortem answers an event has, for account admins, before
-- and after the close. The organiser's deliberate, small loosening of « nothing before the close »
-- (2026-10-26): counts only, never a text, an author, an id, a time or an order.
--
--   { closed, closes_on, eligible, signed, anonymous, total }
--   eligible:  the event's registrations that may answer (neither cancelled nor waitlisted: the
--              rule of private.event_feedback_party), the denominator;
--   signed:    the named answers, exact from the first one;
--   anonymous: the anonymous answers, the caller's own included, when there are at least 3 OTHER
--              than the caller's own (ADR 0029's threshold), otherwise null: the same for 0, 1
--              and 2. The caller's own anonymous answer is known by its author link, which exists
--              only before the close: an admin registered on the event can't move the threshold
--              by saving anonymously and reloading (#345 review). After the levée no anonymous
--              answer has a link, so the threshold is on all of them, as in event_feedback_answers();
--   total:     signed + anonymous, null while anonymous is null (total - signed would give it).
--
-- Same doors as event_feedback_answers() (20261026043829_event_feedback.sql, not redefined here):
-- admin_only first (Comité, Organisateur and « Voir comme » are not admins), the event check, then
-- the due-close, which may run the levée through the events trigger exactly as the other functions
-- do. Otherwise it only reads: no row lock, no advisory lock (a read takes neither; the levée's
-- exclusive advisory lock is not involved), nothing written that a client could read.
CREATE FUNCTION public.event_feedback_counts(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_window record;
    v_signed integer;
    v_anonymous integer;
    v_own_anonymous integer;
    v_eligible integer;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;
    PERFORM private.event_feedback_check_event(p_event_id);
    PERFORM private.close_event_feedback_if_due(p_event_id);
    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);

    SELECT count(*) FILTER (WHERE NOT f.is_anonymous), count(*) FILTER (WHERE f.is_anonymous)
    INTO v_signed, v_anonymous
    FROM public.event_feedback f
    WHERE f.event_id = p_event_id;

    -- The caller's own anonymous answer (0 or 1), by its link: only while the window is open.
    SELECT count(*) INTO v_own_anonymous
    FROM public.event_feedback f
    JOIN public.event_feedback_authors a ON a.feedback_id = f.id
    WHERE f.event_id = p_event_id AND f.is_anonymous AND a.author_id = auth.uid();

    SELECT count(*) INTO v_eligible
    FROM public.user_parties up
    WHERE up.event_id = p_event_id AND up.status <> 'cancelled' AND NOT COALESCE(up.is_waitlisted, false);

    IF v_anonymous - v_own_anonymous < 3 THEN
        v_anonymous := NULL;
    END IF;

    RETURN jsonb_build_object(
        'closed', v_window.closed_at IS NOT NULL,
        'closes_on', v_window.closes_on,
        'eligible', v_eligible,
        'signed', v_signed,
        'anonymous', v_anonymous,
        'total', v_signed + v_anonymous);
END;
$$;

COMMENT ON FUNCTION public.event_feedback_counts(uuid) IS
    'How many post-mortem answers an event has, for account admins only (admin_only otherwise; not Comité nor Organisateur nor « Voir comme ») (#345, ADR 0029). { closed, closes_on, eligible, signed, anonymous, total }: anonymous (the caller''s own included) only when there are 3 or more besides the caller''s own (else null), total null while anonymous is. No text, author, id, time or order.';

REVOKE ALL ON FUNCTION public.event_feedback_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_feedback_counts(uuid) TO authenticated;
