-- #315 (epic #309): post-mortem feedback on an event, « bilan », with true anonymity. No UI here.
-- The design and its accepted limits: ADR 0029.
--
--   * One answer per member per event, written by the owner of a registered or pending,
--     non-waitlisted registration on it (active account). Eight optional free texts, one per
--     category, at least one non-blank; named or anonymous, chosen per answer and switchable.
--   * The window opens the day after the event's last day (Toronto day of event_start_date +
--     duration_days, as "the event is over" everywhere else, #149) and closes at the end of the
--     Toronto day "last day + events.feedback_days" (default 14), or at archival if that comes
--     first. The close is final: events.feedback_closed_at is set once and never cleared, so
--     un-archiving the event or raising feedback_days doesn't reopen it. A DRAFT event, or one
--     without a start date, never opens and never closes by date (archival still closes it).
--   * Nothing is readable by admins before the close: not the answers, not a count, not who
--     answered. At the close, one irreversible step, the « levée » (private.event_feedback_levee),
--     publishes the answers: the anonymous ones are re-inserted with fresh random ids, in random
--     order, and the window's rows (with their author link) are deleted, so no row anywhere ties an
--     anonymous text to an author, party, id or time from the window. Named answers keep theirs.
--   * The levée runs in the BEFORE UPDATE trigger on events: on archival, on an update after (or
--     moving) the close date, and, through a no-op update, at the first call of any of the three
--     functions below once the close date has passed (no scheduler; the link lives until then).
--   * Anonymous answers reach admins only if there are at least 3 for the event, in random (id)
--     order; with 0, 1 or 2 the admin's read is identical.
--   * No client role holds any privilege on the two tables (admins and service_role included);
--     RLS is on with no policy. The SECURITY DEFINER functions below are the only way in.
--   * An answer's author and event are fixed at its first write, never follow the party (an admin
--     may change a party's owner or event, or delete it: none of it reads, moves or removes an
--     answer; see the review of the first design in ADR 0029).
--   * « Voir comme » (ADR 0025): my_event_feedback() hides the member's answer, and whether there
--     is one, in an impersonated session; submit_event_feedback() refuses it before any other check.
--   * ADR 0024 exception: the levée deletes the window's rows of the anonymous answers (texts kept
--     in their published rows). Nothing else deletes an answer.
--
-- Independent from the registration freeze (#314): nothing here writes user_parties.

-- ---------------------------------------------------------------------------------------------
-- The event's close: an offset, and the final marker.

ALTER TABLE public.events
    ADD COLUMN feedback_days integer NOT NULL DEFAULT 14,
    ADD COLUMN feedback_closed_at timestamptz,
    -- At most a year: the close date stays a date Postgres can compute.
    ADD CONSTRAINT events_feedback_days_range CHECK (feedback_days BETWEEN 1 AND 365);

COMMENT ON COLUMN public.events.feedback_days IS
    'Post-mortem (« bilan », #315): days after the event''s last day until the feedback closes, at the end of that Toronto day (or at archival if earlier). Changing it after the close doesn''t reopen it.';
COMMENT ON COLUMN public.events.feedback_closed_at IS
    'When the post-mortem closed (#315): set once by the levée (archival, or the close date passed), never cleared and never written by a client. Not null = closed for good.';

-- The window of an event row: the first and last Toronto day one may answer, and the instant it
-- closes (the end of the last day). Null without a start date.
CREATE FUNCTION private.event_feedback_dates(e public.events, OUT opens_on date, OUT closes_on date, OUT closes_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT d.opens_on,
           d.opens_on + e.feedback_days - 1,
           ((d.opens_on + e.feedback_days)::timestamp AT TIME ZONE 'America/Toronto')
    FROM (SELECT private.toronto_day(e.event_start_date) + COALESCE(e.duration_days, 1) AS opens_on) d;
$$;

-- Whether the event row's post-mortem is due to close: archived, or ACTIVE and past its close
-- date. A DRAFT event never closes by date (its dates may still change).
CREATE FUNCTION private.event_feedback_due(e public.events)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT e.status = 'ARCHIVED'
        OR (e.status = 'ACTIVE' AND COALESCE((private.event_feedback_dates(e)).closes_at <= now(), false));
$$;

-- Backfill: an event already archived, or past its close date, is closed for good. Before the
-- trigger below exists; the close is the scheduled one when it has passed, now otherwise.
UPDATE public.events e
SET feedback_closed_at = LEAST((private.event_feedback_dates(e)).closes_at, now())
WHERE private.event_feedback_due(e);

-- ---------------------------------------------------------------------------------------------
-- The tables.

-- The answers: texts and choice, nothing about who or when.
CREATE TABLE public.event_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    welcome text,
    party_music text,
    safety text,
    lodging text,
    food text,
    communications text,
    schedule text,
    other text,
    is_anonymous boolean NOT NULL DEFAULT false,
    -- The author link's composite foreign key keeps a link on its answer's event.
    CONSTRAINT event_feedback_id_event_key UNIQUE (id, event_id),
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

CREATE INDEX event_feedback_event_id_idx ON public.event_feedback (event_id);

COMMENT ON TABLE public.event_feedback IS
    'Post-mortem answers (« bilan », #315, ADR 0029): texts and the named/anonymous choice. While the window is open each has its author link (event_feedback_authors); at the close the levée re-inserts the anonymous ones with fresh ids, in random order, and deletes their window rows and links. No client privilege: only the SECURITY DEFINER functions read or write it.';
COMMENT ON COLUMN public.event_feedback.welcome IS '« Accueil »';
COMMENT ON COLUMN public.event_feedback.party_music IS '« Party + musique »';
COMMENT ON COLUMN public.event_feedback.safety IS '« Sécurité »';
COMMENT ON COLUMN public.event_feedback.lodging IS '« Hébergement »';
COMMENT ON COLUMN public.event_feedback.food IS '« Nourriture »';
COMMENT ON COLUMN public.event_feedback.communications IS '« Communications »';
COMMENT ON COLUMN public.event_feedback.schedule IS '« Horaire »';
COMMENT ON COLUMN public.event_feedback.other IS '« Autres » (free feedback)';
COMMENT ON COLUMN public.event_feedback.is_anonymous IS
    'Chosen per answer, switchable until the close. Anonymous answers lose their author link at the close.';

-- Who wrote an answer, from which registration, and when. Every answer has one while the window
-- is open; after the close only the named answers do.
CREATE TABLE public.event_feedback_authors (
    feedback_id uuid PRIMARY KEY,
    event_id uuid NOT NULL,
    -- Null only once the profile is hard-deleted (as impersonation_log): the answer stays.
    author_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    -- The registration it was written from; null once that party is deleted: the answer stays.
    party_id uuid REFERENCES public.user_parties (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT event_feedback_authors_feedback_fkey FOREIGN KEY (feedback_id, event_id)
        REFERENCES public.event_feedback (id, event_id) ON DELETE CASCADE,
    CONSTRAINT event_feedback_one_per_author UNIQUE (event_id, author_id)
);

-- The foreign keys' SET NULL looks rows up by party and by author.
CREATE INDEX event_feedback_authors_party_id_idx ON public.event_feedback_authors (party_id);
CREATE INDEX event_feedback_authors_author_id_idx ON public.event_feedback_authors (author_id);

COMMENT ON TABLE public.event_feedback_authors IS
    'The author link of a post-mortem answer (#315, ADR 0029): author, registration and times. Erased for anonymous answers by the levée at the close; kept for named ones. No client privilege.';
COMMENT ON COLUMN public.event_feedback_authors.author_id IS
    'Who wrote it, fixed at the first write: the answer is theirs whoever owns the party later.';
COMMENT ON COLUMN public.event_feedback_authors.party_id IS
    'The registration it was written from, fixed at the first write; null once that party is deleted, the answer kept.';

-- RLS on, no policy: denied to every client role even if a grant came back by mistake.
ALTER TABLE public.event_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_feedback_authors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_feedback FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.event_feedback_authors FROM PUBLIC, anon, authenticated, service_role;

-- « Voir comme » is read-only (ADR 0025): the same statement trigger as every other table.
CREATE TRIGGER trg_refuse_when_impersonating
    BEFORE INSERT OR UPDATE OR DELETE ON public.event_feedback
    FOR EACH STATEMENT EXECUTE FUNCTION private.refuse_when_impersonating();
CREATE TRIGGER trg_refuse_when_impersonating
    BEFORE INSERT OR UPDATE OR DELETE ON public.event_feedback_authors
    FOR EACH STATEMENT EXECUTE FUNCTION private.refuse_when_impersonating();

-- Only SECURITY DEFINER code writes these tables; these keep a later function from breaking the
-- rules by mistake. Once the event's post-mortem has closed nothing is added or edited: an answer
-- stays on its event, and a link keeps its answer, event, author and party (author and party
-- may only become null, through their foreign key's ON DELETE SET NULL).
CREATE FUNCTION private.enforce_event_feedback_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_TABLE_NAME = 'event_feedback' THEN
        IF TG_OP = 'UPDATE' AND NEW.event_id IS DISTINCT FROM OLD.event_id THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation';
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF NEW.author_id IS NULL OR NEW.party_id IS NULL THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation';
        END IF;
    ELSE
        IF NEW.feedback_id IS DISTINCT FROM OLD.feedback_id
           OR NEW.event_id IS DISTINCT FROM OLD.event_id
           OR (NEW.author_id IS DISTINCT FROM OLD.author_id AND NEW.author_id IS NOT NULL)
           OR (NEW.party_id IS DISTINCT FROM OLD.party_id AND NEW.party_id IS NOT NULL) THEN
            RAISE EXCEPTION USING MESSAGE = 'event_feedback_invalid', ERRCODE = 'check_violation';
        END IF;
        -- The foreign keys' SET NULL is the one change a link takes after the close.
        RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = NEW.event_id AND e.feedback_closed_at IS NOT NULL) THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_closed', ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_event_feedback_rules() FROM PUBLIC;

CREATE TRIGGER trg_enforce_event_feedback_rules
    BEFORE INSERT OR UPDATE ON public.event_feedback
    FOR EACH ROW EXECUTE FUNCTION private.enforce_event_feedback_rules();
CREATE TRIGGER trg_enforce_event_feedback_rules
    BEFORE INSERT OR UPDATE ON public.event_feedback_authors
    FOR EACH ROW EXECUTE FUNCTION private.enforce_event_feedback_rules();

-- ---------------------------------------------------------------------------------------------
-- The levée and the close.

-- The levée: publishes an event's answers at its close. Each anonymous answer is re-inserted as a
-- new row (a fresh random id, the event and the texts only), all of them in random order, and its
-- window row is deleted, which deletes its author link (ON DELETE CASCADE). Nothing is left that
-- ties an anonymous text to its author, party, window id or times, nor a physical position that
-- reflects the order they were written in. Named answers stay as they are, with their link.
-- Called only by the events trigger below, which holds the event's row lock and sets the marker.
CREATE FUNCTION private.event_feedback_levee(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
    WITH window_rows AS (
        DELETE FROM public.event_feedback f
        WHERE f.event_id = p_event_id AND f.is_anonymous
        RETURNING f.welcome, f.party_music, f.safety, f.lodging, f.food, f.communications, f.schedule, f.other
    )
    INSERT INTO public.event_feedback
        (event_id, welcome, party_music, safety, lodging, food, communications, schedule, other, is_anonymous)
    SELECT p_event_id, w.welcome, w.party_music, w.safety, w.lodging, w.food, w.communications, w.schedule, w.other, true
    FROM window_rows w
    ORDER BY random();
END;
$$;

REVOKE ALL ON FUNCTION private.event_feedback_levee(uuid) FROM PUBLIC;

-- BEFORE UPDATE on events. A client (an admin's update) never writes feedback_closed_at. When the
-- marker is still null and the event is due to close, before or after this update (archived, or
-- an ACTIVE event past its close date, or a new feedback_days or start date that puts it there),
-- it runs the levée and sets the marker, in this transaction, under this row's lock: a concurrent
-- submit_event_feedback() holds the row FOR SHARE, so it either commits first (and its answer is
-- published) or reads the marker. The marker is the true close: the scheduled close when it has
-- passed, otherwise now. Once set, nothing runs again (un-archiving, a new offset).
-- SECURITY DEFINER: an admin's update runs as authenticated, which can't touch the tables.
CREATE FUNCTION private.close_event_feedback_on_event_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.feedback_closed_at IS DISTINCT FROM OLD.feedback_closed_at THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_close_locked', ERRCODE = '42501';
    END IF;
    IF OLD.feedback_closed_at IS NULL AND (private.event_feedback_due(OLD) OR private.event_feedback_due(NEW)) THEN
        PERFORM private.event_feedback_levee(NEW.id);
        NEW.feedback_closed_at := LEAST((private.event_feedback_dates(OLD)).closes_at, now());
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.close_event_feedback_on_event_update() FROM PUBLIC;

CREATE TRIGGER trg_close_event_feedback
    BEFORE UPDATE ON public.events
    FOR EACH ROW EXECUTE FUNCTION private.close_event_feedback_on_event_update();

-- A new event starts open (null marker), whatever the client sends.
CREATE FUNCTION private.refuse_event_feedback_marker_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.feedback_closed_at IS NOT NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'event_feedback_close_locked', ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.refuse_event_feedback_marker_on_insert() FROM PUBLIC;

CREATE TRIGGER trg_refuse_event_feedback_marker
    BEFORE INSERT ON public.events
    FOR EACH ROW EXECUTE FUNCTION private.refuse_event_feedback_marker_on_insert();

-- Closes the event's post-mortem now if it is due and not closed yet (the close date passed with
-- no update since): a no-op update of the row, which the trigger above turns into the levée. Every
-- function below calls it first, except in « Voir comme » (read-only; nothing is shown there).
CREATE FUNCTION private.close_event_feedback_if_due(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.events e
               WHERE e.id = p_event_id AND e.feedback_closed_at IS NULL AND private.event_feedback_due(e)) THEN
        UPDATE public.events SET feedback_closed_at = feedback_closed_at
        WHERE id = p_event_id AND feedback_closed_at IS NULL;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.close_event_feedback_if_due(uuid) FROM PUBLIC;

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

-- An event's window: state 'not_yet' (not over yet, a DRAFT, or no start date), 'open' or
-- 'closed' (the marker, archived, or past the close date even before the levée has run), its
-- dates (null without a start date) and the marker. One row of nulls for an unknown event.
CREATE FUNCTION private.event_feedback_window(p_event_id uuid,
    OUT state text, OUT opens_on date, OUT closes_on date, OUT closes_at timestamptz, OUT closed_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
               WHEN e.feedback_closed_at IS NOT NULL OR e.status = 'ARCHIVED' THEN 'closed'
               WHEN e.status <> 'ACTIVE' OR d.opens_on IS NULL THEN 'not_yet'
               WHEN d.closes_at <= now() THEN 'closed'
               WHEN d.opens_on <= private.toronto_day(now()) THEN 'open'
               ELSE 'not_yet'
           END,
           d.opens_on, d.closes_on, d.closes_at, e.feedback_closed_at
    FROM (SELECT 1) one
    LEFT JOIN public.events e ON e.id = p_event_id
    LEFT JOIN LATERAL private.event_feedback_dates(e) d ON e.id IS NOT NULL;
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

-- event_not_found for an unknown event, and for a DRAFT one unless the caller is an admin (the
-- events' SELECT policy).
CREATE FUNCTION private.event_feedback_check_event(p_event_id uuid)
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

REVOKE ALL ON FUNCTION private.event_feedback_dates(public.events) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_feedback_due(public.events) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_feedback_categories() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_feedback_answers_of(public.event_feedback) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_feedback_window(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_feedback_party(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_feedback_check_event(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- The member: write their answer, read it back.

-- Creates or replaces the caller's answer for the event, named or anonymous (switchable) while the
-- window is open. p_answers: an object whose keys are among the categories, each a string or
-- null; a blank or missing text is "not answered", and at least one must be answered. Returns the
-- saved answer as my_event_feedback() shows it.
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
    v_feedback_id uuid;
    v_row public.event_feedback;
    v_link public.event_feedback_authors;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'not_authenticated', ERRCODE = '42501';
    END IF;
    -- « Voir comme » is read-only (ADR 0025). The tables' trigger would refuse the write too, but
    -- only after the checks below: refuse first, so nothing else answers an impersonated session.
    IF COALESCE(auth.jwt() ? 'impersonated_by', false) THEN
        RAISE EXCEPTION USING MESSAGE = 'read_only_impersonation', ERRCODE = '42501';
    END IF;
    PERFORM private.event_feedback_check_event(p_event_id);
    PERFORM private.close_event_feedback_if_due(p_event_id);

    -- Hold the event row while writing: the levée (an update of the row) waits for this save to
    -- commit and publishes it, or this reads the marker it set.
    PERFORM 1 FROM public.events e WHERE e.id = p_event_id FOR SHARE;
    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);

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

    -- One save at a time per member and event (two first saves would both insert an answer).
    PERFORM pg_advisory_xact_lock(hashtextextended('event_feedback:' || p_event_id || ':' || auth.uid(), 0));

    -- The caller's own answer on the event, whichever party it was written from: matched on the
    -- stored author, never on the party's current owner (ADR 0029).
    SELECT a.feedback_id INTO v_feedback_id
    FROM public.event_feedback_authors a
    WHERE a.event_id = p_event_id AND a.author_id = auth.uid();

    IF v_feedback_id IS NULL THEN
        INSERT INTO public.event_feedback
            (event_id, welcome, party_music, safety, lodging, food, communications, schedule, other, is_anonymous)
        VALUES (p_event_id,
                v_texts ->> 'welcome', v_texts ->> 'party_music', v_texts ->> 'safety', v_texts ->> 'lodging',
                v_texts ->> 'food', v_texts ->> 'communications', v_texts ->> 'schedule', v_texts ->> 'other',
                COALESCE(p_is_anonymous, false))
        RETURNING * INTO v_row;
        INSERT INTO public.event_feedback_authors (feedback_id, event_id, author_id, party_id)
        VALUES (v_row.id, p_event_id, auth.uid(), v_party.party_id)
        RETURNING * INTO v_link;
    ELSE
        -- An edit replaces the whole answer and may switch named and anonymous; the link keeps its
        -- author and party.
        UPDATE public.event_feedback f
        SET welcome = v_texts ->> 'welcome',
            party_music = v_texts ->> 'party_music',
            safety = v_texts ->> 'safety',
            lodging = v_texts ->> 'lodging',
            food = v_texts ->> 'food',
            communications = v_texts ->> 'communications',
            schedule = v_texts ->> 'schedule',
            other = v_texts ->> 'other',
            is_anonymous = COALESCE(p_is_anonymous, false)
        WHERE f.id = v_feedback_id
        RETURNING * INTO v_row;
        UPDATE public.event_feedback_authors a
        SET updated_at = now()
        WHERE a.feedback_id = v_feedback_id
        RETURNING * INTO v_link;
    END IF;

    RETURN jsonb_build_object(
        'answers', private.event_feedback_answers_of(v_row),
        'is_anonymous', v_row.is_anonymous,
        'created_at', v_link.created_at,
        'updated_at', v_link.updated_at);
END;
$$;

COMMENT ON FUNCTION public.submit_event_feedback(uuid, jsonb, boolean) IS
    'Creates or replaces the caller''s post-mortem answer for the event (#315), named or anonymous: owner of a registered or pending, non-waitlisted registration, while the window is open. Codes: not_authenticated, read_only_impersonation, event_not_found (also a DRAFT event, for non-admins), event_feedback_not_eligible {reason}, event_feedback_not_open {opens_on}, event_feedback_closed, event_feedback_invalid {category}, event_feedback_too_long {category, max}, event_feedback_empty.';

-- The caller's side of the event's post-mortem:
--   { eligible, reason, window: 'not_yet'|'open'|'closed', opens_on, closes_on, closes_at,
--     closed_at, answer, answer_hidden }
-- answer: before the close, the caller's answer (named or anonymous); after it, their named answer
-- only, since an anonymous one has no author any more: null then means "no named answer", and the
-- database can't tell an anonymous answer from none. In a « Voir comme » session answer is always
-- null and answer_hidden true, and nothing else depends on the answer.
CREATE FUNCTION public.my_event_feedback(p_event_id uuid)
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
    PERFORM private.event_feedback_check_event(p_event_id);
    IF NOT v_hidden THEN
        PERFORM private.close_event_feedback_if_due(p_event_id);
    END IF;

    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);
    SELECT * INTO v_party FROM private.event_feedback_party(p_event_id);

    -- The caller's own answer: the one they wrote (author_id), not the one written from a party
    -- they own now, which an admin can reassign to themselves (ADR 0029).
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

COMMENT ON FUNCTION public.my_event_feedback(uuid) IS
    'The caller''s post-mortem for the event (#315): eligible and reason (not_registered, cancelled, waitlisted, account_deleted), window (not_yet, open, closed), opens_on, closes_on, closes_at, closed_at, and their answer (after the close, a named one only). Hidden (answer null, answer_hidden true) in a « Voir comme » session.';

-- ---------------------------------------------------------------------------------------------
-- The admins: the answers of an event, after its close.

-- { closed, closes_on, closes_at, closed_at, named, anonymous }
-- Before the close: closed false, named and anonymous null, nothing that changes when a member
-- writes. After it:
--   named: [{ answers, author: { user_id, party_id, full_name, email } | null, created_at, updated_at }],
--          oldest first (author null once the profile is hard-deleted);
--   anonymous: [{ answers }] in random (id) order when the event has 3 or more, otherwise [],
--          the same for 0, 1 or 2.
CREATE FUNCTION public.event_feedback_answers(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_window record;
    v_named jsonb;
    v_anonymous jsonb := '[]'::jsonb;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;
    PERFORM private.event_feedback_check_event(p_event_id);
    PERFORM private.close_event_feedback_if_due(p_event_id);
    SELECT * INTO v_window FROM private.event_feedback_window(p_event_id);

    IF v_window.closed_at IS NULL THEN
        RETURN jsonb_build_object(
            'closed', false, 'closes_on', v_window.closes_on, 'closes_at', v_window.closes_at,
            'closed_at', NULL, 'named', NULL, 'anonymous', NULL);
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'answers', private.event_feedback_answers_of(f),
               -- The stored author and party, never the party's current owner or event.
               'author', CASE WHEN a.author_id IS NOT NULL THEN jsonb_build_object(
                   'user_id', a.author_id,
                   'party_id', a.party_id,
                   'full_name', p.full_name,
                   'email', p.email) END,
               'created_at', a.created_at,
               'updated_at', a.updated_at)
               ORDER BY a.created_at, f.id), '[]'::jsonb)
    INTO v_named
    FROM public.event_feedback f
    JOIN public.event_feedback_authors a ON a.feedback_id = f.id
    LEFT JOIN public.profiles p ON p.id = a.author_id
    WHERE f.event_id = p_event_id AND NOT f.is_anonymous;

    IF (SELECT count(*) FROM public.event_feedback f WHERE f.event_id = p_event_id AND f.is_anonymous) >= 3 THEN
        SELECT jsonb_agg(jsonb_build_object('answers', private.event_feedback_answers_of(f)) ORDER BY f.id)
        INTO v_anonymous
        FROM public.event_feedback f
        WHERE f.event_id = p_event_id AND f.is_anonymous;
    END IF;

    RETURN jsonb_build_object(
        'closed', true, 'closes_on', v_window.closes_on, 'closes_at', v_window.closes_at,
        'closed_at', v_window.closed_at, 'named', v_named, 'anonymous', v_anonymous);
END;
$$;

COMMENT ON FUNCTION public.event_feedback_answers(uuid) IS
    'An event''s post-mortem answers, for account admins only (admin_only otherwise; not Comité nor Organisateur) (#315). Nothing before the close. After it, named answers with their author, and the anonymous answers'' texts only, in random order, only when there are 3 or more.';

REVOKE ALL ON FUNCTION public.submit_event_feedback(uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_event_feedback(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_feedback_answers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_event_feedback(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_event_feedback(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_feedback_answers(uuid) TO authenticated;
