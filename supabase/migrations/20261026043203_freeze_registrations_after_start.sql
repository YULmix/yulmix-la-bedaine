-- #314: from the event's start (events.event_start_date, an instant), a member's registration is
-- frozen. A member can no longer create, edit, add or remove participants, cancel, or register
-- again on that event; admins are unaffected. A null start date never freezes.
--
-- This is a second, stricter lock beside the close date (#38, private.registration_closed()),
-- which stays as it is: after the close date a member can still add and edit, only not cancel or
-- shrink the party; after the start, nothing.
--
-- Enforced on public.user_parties, which every member write to a registration touches:
--   * a direct INSERT/UPDATE/DELETE through the API (cancelling is an UPDATE of status);
--   * save_registration(), which inserts the party or ends with an UPDATE of it, and checks the
--     same rule first so a frozen save fails with this code before any other (the close date's
--     registration_attendee_removal_locked, say).
-- Attendees need no trigger of their own: guard_attendee_write() only lets a member write them
-- from inside save_registration(), which the checks above refuse.
--
-- Who passes:
--   * admins (public.is_admin()): corrections, payments, notes, registration_edits logging;
--   * the service role, migrations and direct database sessions (the demo seed, seed.sql, Edge
--     Functions), like the other end-user guards (auth.role() not authenticated/anon);
--   * an Organisateur's set_payment_status() and save_logistics(), which already authorise the
--     caller on the party's event and mark the party in bedaine.organiser_party (ADR 0023) for
--     protect_admin_only_party_fields(); the same mark lets them through here. A client can't set
--     it (PostgREST exposes no set_config).
--   * the first-price cascade: when an event gets its first price (apply_event_pricing(), an
--     Organisateur and above), trg_lock_unpriced_registrations_on_first_price updates that event's
--     unpriced parties. lock_unpriced_registrations_on_first_price() (redefined below) marks the
--     event in bedaine.pricing_event around its UPDATE; the freeze lets that event's parties
--     through. It only runs from an UPDATE of events, which members can't do (RLS).
--
-- Error: registration_frozen, DETAIL {"start_date": <instant>} (ADR 0021).
--
-- save_registration() is copied from 20261003222508_soft_delete_attendees.sql (its latest
-- definition); the only change is the registration_frozen check after attendees_required.
-- lock_unpriced_registrations_on_first_price() is copied from
-- 20260928193752_lock_price_per_registration.sql; the only change is the bedaine.pricing_event mark.
--
-- delete_my_account() is copied from 20260930044216_event_schedule_timestamptz.sql; the only change
-- is that it also refuses (account_deletion_locked) from the event's start, since cancelling is no
-- longer possible then. Without it, an event whose close date is the start day (x_reg_close_weeks
-- 0) or that has none (null) would reach the cancel UPDATE and fail with registration_frozen.

CREATE FUNCTION private.registration_started(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(now() >= e.event_start_date, false)
    FROM public.events e
    WHERE e.id = p_event_id;
$$;

COMMENT ON FUNCTION private.registration_started(uuid) IS
    'True from the event''s start instant (event_start_date) on; false when it is null (#314).';

REVOKE ALL ON FUNCTION private.registration_started(uuid) FROM PUBLIC;
-- SECURITY DEFINER: a start date must not read as null to a caller who can't see the event, which
-- would let the write through. It returns one boolean about an event the caller names.
GRANT EXECUTE ON FUNCTION private.registration_started(uuid) TO authenticated, service_role;

-- The freeze applies to end users (JWT role authenticated/anon) who are not admins.
CREATE FUNCTION private.registration_frozen_for_caller(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT (auth.role() = 'authenticated' OR auth.role() = 'anon')
       AND NOT public.is_admin()
       AND COALESCE(private.registration_started(p_event_id), false);
$$;

REVOKE ALL ON FUNCTION private.registration_frozen_for_caller(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.registration_frozen_for_caller(uuid) TO authenticated, service_role;

CREATE FUNCTION private.raise_registration_frozen(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION USING
        MESSAGE = 'registration_frozen',
        DETAIL = json_build_object('start_date', (
            SELECT e.event_start_date FROM public.events e WHERE e.id = p_event_id))::text,
        ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.raise_registration_frozen(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.raise_registration_frozen(uuid) TO authenticated, service_role;

CREATE FUNCTION private.enforce_registration_frozen_after_start()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- An Organisateur's set_payment_status() / save_logistics() on this party (see above).
    IF TG_OP = 'UPDATE' AND current_setting('bedaine.organiser_party', true) = OLD.id::text THEN
        RETURN NEW;
    END IF;
    -- The first-price cascade on this party's event (see above).
    IF TG_OP = 'UPDATE' AND current_setting('bedaine.pricing_event', true) = OLD.event_id::text
       AND NEW.event_id = OLD.event_id THEN
        RETURN NEW;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') AND private.registration_frozen_for_caller(OLD.event_id) THEN
        PERFORM private.raise_registration_frozen(OLD.event_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND private.registration_frozen_for_caller(NEW.event_id) THEN
        PERFORM private.raise_registration_frozen(NEW.event_id);
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_registration_frozen_after_start() FROM PUBLIC;

CREATE TRIGGER trg_enforce_registration_frozen_after_start
BEFORE INSERT OR UPDATE OR DELETE ON public.user_parties
FOR EACH ROW
EXECUTE FUNCTION private.enforce_registration_frozen_after_start();

CREATE OR REPLACE FUNCTION public.save_registration(p_event_id uuid, p_attendees jsonb, p_party jsonb DEFAULT '{}'::jsonb, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS user_parties
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
    v_user_id uuid := COALESCE(p_user_id, auth.uid());
    v_party public.user_parties;
    v_before jsonb;
    v_size_before integer;
    v_input jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'not_authenticated';
    END IF;
    IF jsonb_typeof(p_attendees) IS DISTINCT FROM 'array' OR jsonb_array_length(p_attendees) = 0 THEN
        RAISE EXCEPTION USING MESSAGE = 'attendees_required', ERRCODE = '22023';
    END IF;
    -- #314: from the event's start a member's registration is frozen (admins pass).
    IF private.registration_frozen_for_caller(p_event_id) THEN
        PERFORM private.raise_registration_frozen(p_event_id);
    END IF;

    SELECT * INTO v_party
    FROM public.user_parties
    WHERE user_id = v_user_id AND event_id = p_event_id
    FOR UPDATE;

    IF FOUND THEN
        v_before := private.attendees_snapshot(v_party.id);
        v_size_before := jsonb_array_length(v_before);
    ELSE
        INSERT INTO public.user_parties (id, user_id, event_id)
        VALUES (COALESCE((p_party->>'id')::uuid, gen_random_uuid()), v_user_id, p_event_id)
        RETURNING * INTO v_party;
    END IF;

    PERFORM set_config('bedaine.saving_party', v_party.id::text, true);
    PERFORM set_config('bedaine.attendees_before', COALESCE(v_before::text, 'new'), true);

    -- Match entries to this party's attendees by id; the first entry with a given id wins. A
    -- removed attendee's id matches nothing: they are never revived, the entry is a new attendee.
    SELECT jsonb_agg(jsonb_build_object('ord', m.ord, 'existing_id', m.existing_id, 'entry', m.entry))
    INTO v_input
    FROM (
        SELECT i.ord,
               CASE WHEN row_number() OVER (PARTITION BY a.id ORDER BY i.ord) = 1 THEN a.id END AS existing_id,
               i.entry
        FROM jsonb_array_elements(p_attendees) WITH ORDINALITY AS i(entry, ord)
        LEFT JOIN public.attendees a
          ON a.party_id = v_party.id
         AND a.id::text = i.entry->>'id'
         AND a.deleted_at IS NULL
    ) m;

    -- The attendees left out are removed (#237): soft-deleted, their places freed.
    PERFORM private.remove_party_attendees(v_party.id, ARRAY(
        SELECT r.existing_id FROM jsonb_to_recordset(v_input) AS r(existing_id uuid) WHERE r.existing_id IS NOT NULL
    ));

    UPDATE public.attendees a
    SET "position" = r.ord,
        "name" = btrim(r.entry->>'name'),
        "type" = r.entry->>'type',
        participation = r.entry->>'participation',
        is_new_member = COALESCE((r.entry->>'is_new_member')::boolean, false),
        sleeping_preference = COALESCE(r.entry->>'sleeping_preference', ''),
        sleeping_preference_other = COALESCE(r.entry->>'sleeping_preference_other', ''),
        bed_reason = CASE WHEN r.entry->>'sleeping_preference' = 'bed' THEN COALESCE(r.entry->>'bed_reason', '') ELSE '' END,
        bed_reason_other = CASE WHEN r.entry->>'sleeping_preference' = 'bed' THEN COALESCE(r.entry->>'bed_reason_other', '') ELSE '' END,
        dietary_needs = private.dietary_needs_of(r.entry->'dietary_needs'),
        dietary_other = COALESCE(r.entry->>'dietary_other', '')
    FROM jsonb_to_recordset(v_input) AS r(ord integer, existing_id uuid, entry jsonb)
    WHERE r.existing_id = a.id;

    INSERT INTO public.attendees (
        party_id, "position", "name", "type", participation, is_new_member,
        sleeping_preference, sleeping_preference_other, bed_reason, bed_reason_other,
        dietary_needs, dietary_other
    )
    SELECT v_party.id, r.ord, btrim(r.entry->>'name'), r.entry->>'type', r.entry->>'participation',
           COALESCE((r.entry->>'is_new_member')::boolean, false),
           COALESCE(r.entry->>'sleeping_preference', ''),
           COALESCE(r.entry->>'sleeping_preference_other', ''),
           CASE WHEN r.entry->>'sleeping_preference' = 'bed' THEN COALESCE(r.entry->>'bed_reason', '') ELSE '' END,
           CASE WHEN r.entry->>'sleeping_preference' = 'bed' THEN COALESCE(r.entry->>'bed_reason_other', '') ELSE '' END,
           private.dietary_needs_of(r.entry->'dietary_needs'),
           COALESCE(r.entry->>'dietary_other', '')
    FROM jsonb_to_recordset(v_input) AS r(ord integer, existing_id uuid, entry jsonb)
    WHERE r.existing_id IS NULL
    ORDER BY r.ord;

    -- After the close date a member can't shrink an active party: what it owes stays owed.
    IF v_size_before IS NOT NULL
       AND v_party.status IS DISTINCT FROM 'cancelled'
       AND jsonb_array_length(p_attendees) < v_size_before
       AND NOT public.is_admin()
       AND private.registration_closed(p_event_id) THEN
        RAISE EXCEPTION USING MESSAGE = 'registration_attendee_removal_locked', DETAIL = json_build_object('close_date', (
                SELECT private.toronto_day(e.event_start_date) - (e.x_reg_close_weeks * 7)
                FROM public.events e WHERE e.id = p_event_id))::text;
    END IF;

    UPDATE public.user_parties
    SET logistics = COALESCE(p_party->'logistics', logistics),
        transport = COALESCE(p_party->'transport', transport),
        music_requests = CASE WHEN p_party ? 'music_requests' THEN p_party->>'music_requests' ELSE music_requests END,
        message_to_organizers = CASE WHEN p_party ? 'message_to_organizers' THEN p_party->>'message_to_organizers' ELSE message_to_organizers END,
        status = 'registered'
    WHERE id = v_party.id
    RETURNING * INTO v_party;

    PERFORM set_config('bedaine.saving_party', '', true);
    PERFORM set_config('bedaine.attendees_before', '', true);

    RETURN v_party;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lock_unpriced_registrations_on_first_price()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- #314: the freeze from the event's start lets this cascade through (see above).
    PERFORM set_config('bedaine.pricing_event', NEW.id::text, true);
    UPDATE public.user_parties
    SET locked_selling_price_whole_event = NULL
    WHERE event_id = NEW.id
      AND locked_selling_price_whole_event IS NULL
      AND payment_status IS DISTINCT FROM 'paid';
    PERFORM set_config('bedaine.pricing_event', '', true);

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_today date := private.toronto_day(now());
    v_locked record;
BEGIN
    -- Errors are stable English codes (MESSAGE) with their parameters as JSON (DETAIL); the app
    -- maps them to French in src/lib/dbErrors.js. No user-facing text lives in the database.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'not_authenticated';
    END IF;

    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND email = 'yulmixalabedaine@gmail.com') THEN
        RAISE EXCEPTION USING MESSAGE = 'root_admin_cannot_be_deleted';
    END IF;

    -- Already deleted: nothing left to do.
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND deleted_at IS NOT NULL) THEN
        RETURN;
    END IF;

    -- "Still to come": not archived, and not over (start day + duration, in Toronto days). An
    -- event with no start date has no close date either, so it never locks. #314: from the
    -- event's start it locks whatever the close date (none, or the start day itself); the date
    -- shown is then the start day when there is no close date.
    SELECT e.theme,
           COALESCE(private.toronto_day(e.event_start_date) - (e.x_reg_close_weeks * 7),
                    private.toronto_day(e.event_start_date)) AS close_date INTO v_locked
    FROM public.user_parties up
    JOIN public.events e ON e.id = up.event_id
    WHERE up.user_id = v_uid
      AND up.status IN ('registered', 'pending')
      AND e.status IS DISTINCT FROM 'ARCHIVED'
      AND e.event_start_date IS NOT NULL
      AND private.toronto_day(e.event_start_date) + COALESCE(e.duration_days, 1) > v_today
      AND (now() >= e.event_start_date
           OR (e.x_reg_close_weeks IS NOT NULL
               AND v_today > private.toronto_day(e.event_start_date) - (e.x_reg_close_weeks * 7)))
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION USING
            MESSAGE = 'account_deletion_locked',
            DETAIL = json_build_object('event', v_locked.theme, 'close_date', v_locked.close_date)::text;
    END IF;

    UPDATE public.user_parties up
    SET status = 'cancelled'
    FROM public.events e
    WHERE e.id = up.event_id
      AND up.user_id = v_uid
      AND up.status IN ('registered', 'pending')
      AND e.status IS DISTINCT FROM 'ARCHIVED'
      AND (e.event_start_date IS NULL OR private.toronto_day(e.event_start_date) + COALESCE(e.duration_days, 1) > v_today);

    UPDATE public.profiles SET deleted_at = now() WHERE id = v_uid;
END;
$$;
