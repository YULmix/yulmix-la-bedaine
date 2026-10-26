-- #315 (epic #309): post-mortem feedback on an event, « bilan ». No UI here.
--
--   * event_feedback: one answer per registration (party), written by its owner. Eight optional
--     free texts, one per category, at least one non-blank; is_anonymous chosen per answer.
--   * The window: opens the day after the event's last day (Toronto day of event_start_date +
--     duration_days, as "the event is over" everywhere else, #149) and closes when the event is
--     archived. A DRAFT event, or one without a start date, has no open window.
--   * Eligible: the owner of a registered or pending, non-waitlisted registration on the event,
--     with an active account. Cancelled and waitlisted registrations can't answer.
--   * Readable by account admins only (not Comité nor Organisateur), and anonymity is enforced by
--     the database: no client role has any privilege on the table, admins included. Every read
--     and write goes through the SECURITY DEFINER functions below, and the admin's read leaves out
--     everything that could lead back to the author of an anonymous answer: the party, the
--     author, the row's id and its timestamps (which could be matched against other activity),
--     and anonymous answers come after the named ones in a random (id) order. A table-level
--     SELECT for admins, even through a view, would hand them party_id, and with it
--     user_parties.user_id and the profile.
--   * « Voir comme » (ADR 0025) runs in the member's real session, so the member's own read hides
--     their answer, and whether they have one, when the JWT carries impersonated_by: otherwise an
--     admin could open a member's session to learn who wrote an anonymous answer. Writes are
--     already refused there by the read-only trigger, attached below.
--   * No hard deletes (ADR 0024): nothing deletes an answer; it goes with its party, like the
--     party's other rows, only when an admin deletes the party.
--
-- Independent from the registration freeze (#314): nothing here writes user_parties.

-- ---------------------------------------------------------------------------------------------
-- The table.

CREATE TABLE public.event_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id uuid NOT NULL REFERENCES public.user_parties (id) ON DELETE CASCADE,
    welcome text,
    party_music text,
    safety text,
    lodging text,
    food text,
    communications text,
    schedule text,
    other text,
    is_anonymous boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT event_feedback_one_per_party UNIQUE (party_id),
    -- NULL = not answered; a stored text is never blank (has a non-space character), and stays reasonably short.
    CONSTRAINT event_feedback_texts_valid CHECK (
        (welcome IS NULL OR (welcome ~ '\S' AND char_length(welcome) <= 5000))
        AND (party_music IS NULL OR (party_music ~ '\S' AND char_length(party_music) <= 5000))
        AND (safety IS NULL OR (safety ~ '\S' AND char_length(safety) <= 5000))
        AND (lodging IS NULL OR (lodging ~ '\S' AND char_length(lodging) <= 5000))
        AND (food IS NULL OR (food ~ '\S' AND char_length(food) <= 5000))
        AND (communications IS NULL OR (communications ~ '\S' AND char_length(communications) <= 5000))
        AND (schedule IS NULL OR (schedule ~ '\S' AND char_length(schedule) <= 5000))
        AND (other IS NULL OR (other ~ '\S' AND char_length(other) <= 5000))
    ),
    CONSTRAINT event_feedback_not_empty CHECK (
        num_nonnulls(welcome, party_music, safety, lodging, food, communications, schedule, other) > 0
    )
);

COMMENT ON TABLE public.event_feedback IS
    'Post-mortem answers (« bilan », #315): one per registration, by its owner, while the event is over and not archived. No client privilege: read and written only through submit_event_feedback(), my_event_feedback() and event_feedback_answers(), which keep anonymous answers anonymous.';
COMMENT ON COLUMN public.event_feedback.welcome IS '« Accueil »';
COMMENT ON COLUMN public.event_feedback.party_music IS '« Party + musique »';
COMMENT ON COLUMN public.event_feedback.safety IS '« Sécurité »';
COMMENT ON COLUMN public.event_feedback.lodging IS '« Hébergement »';
COMMENT ON COLUMN public.event_feedback.food IS '« Nourriture »';
COMMENT ON COLUMN public.event_feedback.communications IS '« Communications »';
COMMENT ON COLUMN public.event_feedback.schedule IS '« Horaire »';
COMMENT ON COLUMN public.event_feedback.other IS '« Autres » (free feedback)';
COMMENT ON COLUMN public.event_feedback.is_anonymous IS
    'Chosen by the respondent per answer: event_feedback_answers() then gives admins no author, party, id nor time.';

-- RLS on, no policy: denied to every client role even if a grant came back by mistake.
ALTER TABLE public.event_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_feedback FROM PUBLIC, anon, authenticated, service_role;

-- « Voir comme » is read-only (ADR 0025): the same statement trigger as every other table.
CREATE TRIGGER trg_refuse_when_impersonating
    BEFORE INSERT OR UPDATE OR DELETE ON public.event_feedback
    FOR EACH STATEMENT EXECUTE FUNCTION private.refuse_when_impersonating();

-- ---------------------------------------------------------------------------------------------
-- Helpers.

-- The categories, in display order: the keys of the answers object and the table's columns.
CREATE FUNCTION private.event_feedback_categories()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY['welcome', 'party_music', 'safety', 'lodging', 'food', 'communications', 'schedule', 'other'];
$$;

-- An answer's texts as one object, every category present (null when not answered).
CREATE FUNCTION private.event_feedback_answers_of(f public.event_feedback)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'welcome', f.welcome,
        'party_music', f.party_music,
        'safety', f.safety,
        'lodging', f.lodging,
        'food', f.food,
        'communications', f.communications,
        'schedule', f.schedule,
        'other', f.other);
$$;

-- An event's feedback window: 'open', 'not_yet' (the event isn't over, or is a DRAFT, or has no
-- start date) or 'closed' (archived), and the day it opens (null without a start date).
CREATE FUNCTION private.event_feedback_window(p_event_id uuid, OUT state text, OUT opens_on date)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
               WHEN e.status = 'ARCHIVED' THEN 'closed'
               WHEN e.status = 'ACTIVE'
                    AND e.event_start_date IS NOT NULL
                    AND private.toronto_day(e.event_start_date) + COALESCE(e.duration_days, 1)
                        <= private.toronto_day(now())
                   THEN 'open'
               ELSE 'not_yet'
           END,
           private.toronto_day(e.event_start_date) + COALESCE(e.duration_days, 1)
    FROM public.events e
    WHERE e.id = p_event_id;
$$;

-- The caller's registration on the event and whether it may answer: reason is null when it may,
-- otherwise 'not_registered', 'cancelled', 'waitlisted' or 'account_deleted'.
CREATE FUNCTION private.event_feedback_party(p_event_id uuid, OUT party_id uuid, OUT reason text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT up.id,
           CASE
               WHEN NOT public.is_account_active() THEN 'account_deleted'
               WHEN up.id IS NULL THEN 'not_registered'
               WHEN up.status = 'cancelled' THEN 'cancelled'
               WHEN up.is_waitlisted THEN 'waitlisted'
           END
    FROM (SELECT 1) one
    LEFT JOIN public.user_parties up
           ON up.event_id = p_event_id AND up.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION private.event_feedback_categories() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_feedback_answers_of(public.event_feedback) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_feedback_window(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_feedback_party(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- The member: write their answer, read it back.

-- Creates or replaces the caller's answer for the event. p_answers: an object whose keys are
-- among the categories, each a string or null; a blank or missing text is "not answered", and at
-- least one must be answered. Returns the saved answer as my_event_feedback() shows it.
CREATE FUNCTION public.submit_event_feedback(p_event_id uuid, p_answers jsonb, p_is_anonymous boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_window record;
    v_party record;
    v_key text;
    v_texts jsonb := '{}'::jsonb;
    v_text text;
    v_row public.event_feedback;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'not_authenticated', ERRCODE = '42501';
    END IF;

    -- One row of nulls for an unknown event (a function with OUT parameters, not a set).
    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);
    IF v_window.state IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'event_not_found', ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_party FROM private.event_feedback_party(p_event_id);
    IF v_party.reason IS NOT NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_not_eligible', ERRCODE = '42501',
            DETAIL = json_build_object('reason', v_party.reason)::text;
    END IF;

    IF v_window.state = 'closed' THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_closed', ERRCODE = 'check_violation';
    ELSIF v_window.state <> 'open' THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_not_open', ERRCODE = 'check_violation',
            DETAIL = json_build_object('opens_on', v_window.opens_on)::text;
    END IF;

    IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_answers) LOOP
        IF NOT v_key = ANY (private.event_feedback_categories()) THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation',
                DETAIL = json_build_object('category', v_key)::text;
        END IF;
        IF jsonb_typeof(p_answers -> v_key) NOT IN ('string', 'null') THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation',
                DETAIL = json_build_object('category', v_key)::text;
        END IF;
        -- Surrounding whitespace (newlines included) goes; a blank text is "not answered".
        v_text := NULLIF(regexp_replace(p_answers ->> v_key, '^\s+|\s+$', '', 'g'), '');
        IF char_length(v_text) > 5000 THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_too_long', ERRCODE = 'check_violation',
                DETAIL = json_build_object('category', v_key, 'max', 5000)::text;
        END IF;
        IF v_text IS NOT NULL THEN
            v_texts := v_texts || jsonb_build_object(v_key, v_text);
        END IF;
    END LOOP;
    IF v_texts = '{}'::jsonb THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_empty', ERRCODE = 'check_violation';
    END IF;

    -- The unique constraint keeps it to one row per party, also between two concurrent saves.
    INSERT INTO public.event_feedback AS f
        (party_id, welcome, party_music, safety, lodging, food, communications, schedule, other, is_anonymous)
    VALUES (v_party.party_id,
            v_texts ->> 'welcome', v_texts ->> 'party_music', v_texts ->> 'safety', v_texts ->> 'lodging',
            v_texts ->> 'food', v_texts ->> 'communications', v_texts ->> 'schedule', v_texts ->> 'other',
            COALESCE(p_is_anonymous, false))
    ON CONFLICT ON CONSTRAINT event_feedback_one_per_party DO UPDATE
        SET welcome = EXCLUDED.welcome,
            party_music = EXCLUDED.party_music,
            safety = EXCLUDED.safety,
            lodging = EXCLUDED.lodging,
            food = EXCLUDED.food,
            communications = EXCLUDED.communications,
            schedule = EXCLUDED.schedule,
            other = EXCLUDED.other,
            is_anonymous = EXCLUDED.is_anonymous,
            updated_at = now()
    RETURNING f.* INTO v_row;

    RETURN jsonb_build_object(
        'answers', private.event_feedback_answers_of(v_row),
        'is_anonymous', v_row.is_anonymous,
        'created_at', v_row.created_at,
        'updated_at', v_row.updated_at);
END;
$$;

COMMENT ON FUNCTION public.submit_event_feedback(uuid, jsonb, boolean) IS
    'Creates or replaces the caller''s post-mortem answer for the event (#315): owner of a registered or pending, non-waitlisted registration, while the window is open. Codes: not_authenticated, event_not_found, event_feedback_not_eligible {reason}, event_feedback_not_open {opens_on}, event_feedback_closed, event_feedback_invalid {category}, event_feedback_too_long {category, max}, event_feedback_empty.';

-- The caller's side of the event's post-mortem: whether they may answer and when, and their answer.
--   { eligible, reason, window: 'open'|'not_yet'|'closed', opens_on, answer, answer_hidden }
-- answer is null when they haven't answered; in a « Voir comme » session it is always null and
-- answer_hidden true, so an admin can't learn who wrote what.
CREATE FUNCTION public.my_event_feedback(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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

    -- A DRAFT event is the admins' only (events' SELECT policy): not found for anyone else.
    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);
    IF v_window.state IS NULL OR (NOT public.is_admin()
                     AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.status = 'DRAFT')) THEN
        RAISE EXCEPTION USING MESSAGE = 'event_not_found', ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_party FROM private.event_feedback_party(p_event_id);

    IF NOT v_hidden AND v_party.party_id IS NOT NULL AND public.is_account_active() THEN
        SELECT jsonb_build_object(
                   'answers', private.event_feedback_answers_of(f),
                   'is_anonymous', f.is_anonymous,
                   'created_at', f.created_at,
                   'updated_at', f.updated_at)
        INTO v_answer
        FROM public.event_feedback f
        WHERE f.party_id = v_party.party_id;
    END IF;

    RETURN jsonb_build_object(
        'eligible', v_party.reason IS NULL,
        'reason', v_party.reason,
        'window', v_window.state,
        'opens_on', v_window.opens_on,
        'answer', v_answer,
        'answer_hidden', v_hidden);
END;
$$;

COMMENT ON FUNCTION public.my_event_feedback(uuid) IS
    'The caller''s post-mortem for the event (#315): eligible and reason (not_registered, cancelled, waitlisted, account_deleted), window (open, not_yet, closed) and opens_on, and their answer. Hidden (answer null, answer_hidden true) in a « Voir comme » session.';

-- ---------------------------------------------------------------------------------------------
-- The admins: every answer of an event.

-- [{ is_anonymous, answers, author: { user_id, party_id, full_name, email } | null,
--    created_at | null, updated_at | null }]
-- An anonymous answer carries its texts and nothing else: no author, party, id nor times, and
-- such answers come after the named ones in id (random) order, so their position says nothing
-- about when they were written either. Named answers come first, oldest first.
CREATE FUNCTION public.event_feedback_answers(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(
                   CASE WHEN f.is_anonymous THEN
                       jsonb_build_object(
                           'is_anonymous', true,
                           'answers', private.event_feedback_answers_of(f),
                           'author', NULL,
                           'created_at', NULL,
                           'updated_at', NULL)
                   ELSE
                       jsonb_build_object(
                           'is_anonymous', false,
                           'answers', private.event_feedback_answers_of(f),
                           'author', jsonb_build_object(
                               'user_id', up.user_id,
                               'party_id', up.id,
                               'full_name', p.full_name,
                               'email', p.email),
                           'created_at', f.created_at,
                           'updated_at', f.updated_at)
                   END
                   ORDER BY f.is_anonymous,
                            CASE WHEN NOT f.is_anonymous THEN f.created_at END,
                            f.id)
        FROM public.event_feedback f
        JOIN public.user_parties up ON up.id = f.party_id
        LEFT JOIN public.profiles p ON p.id = up.user_id
        WHERE up.event_id = p_event_id
    ), '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.event_feedback_answers(uuid) IS
    'Every post-mortem answer of an event, for account admins only (admin_only otherwise; not Comité nor Organisateur) (#315). An anonymous answer carries no author, party, id nor time, and comes after the named ones in random order.';

REVOKE ALL ON FUNCTION public.submit_event_feedback(uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_event_feedback(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_feedback_answers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_event_feedback(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_event_feedback(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_feedback_answers(uuid) TO authenticated;
