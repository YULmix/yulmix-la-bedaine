-- #102: every error our SQL raises is a stable English code, never a sentence (ADR 0021).
--
-- The message is a snake_case code and any parameters go, as JSON, in DETAIL. src/lib/dbErrors.js
-- maps each code to its French text in fr.json, so no user-facing wording lives in SQL and the app
-- never has to show a raw database message. PR #100 (#36) started this; this migration converts
-- the functions still raising sentences:
--
--   admin_set_is_admin                          admin_only, own_admin_status_unchangeable,
--                                               root_admin_cannot_be_demoted
--   enforce_event_budget                        event_budget_lines_invalid, event_budget_line_invalid {line}
--   enforce_registration_lock_after_close_date  registration_cancel_locked {close_date}
--   prevent_event_deletion                      event_deletion_forbidden
--   prevent_self_privilege_escalation           own_admin_status_unchangeable,
--                                               self_admin_promotion_forbidden
--   protect_root_admin                          root_admin_cannot_be_demoted
--   save_registration                           registration_attendee_removal_locked {close_date}
--
-- Behaviour is otherwise unchanged: same conditions, same SQLSTATEs. Each function is re-created
-- from its current definition (CREATE OR REPLACE keeps its grants and triggers).

CREATE OR REPLACE FUNCTION public.admin_set_is_admin(target_user_id uuid, new_is_admin boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    target_email TEXT;
BEGIN
    -- Ensure caller is admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only';
    END IF;

    -- Prevent self-promotion/demotion
    IF target_user_id = auth.uid() THEN
        RAISE EXCEPTION USING MESSAGE = 'own_admin_status_unchangeable';
    END IF;

    -- Fetch target email to protect root admin
    SELECT email INTO target_email
    FROM public.profiles
    WHERE id = target_user_id;

    -- Block demotion of root admin
    IF target_email = 'yulmixalabedaine@gmail.com' AND new_is_admin = FALSE THEN
        RAISE EXCEPTION USING MESSAGE = 'root_admin_cannot_be_demoted';
    END IF;

    -- Update the profile
    UPDATE public.profiles
    SET is_admin = new_is_admin
    WHERE id = target_user_id;

    -- Ensure at least one admin remains (hardcoded root admin excluded)
    -- Root admin yulmixalabedaine@gmail.com is already protected by is_admin() function
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_event_budget()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_line JSONB;
    v_total NUMERIC := 0;
BEGIN
    IF jsonb_typeof(NEW.lines) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION USING MESSAGE = 'event_budget_lines_invalid', ERRCODE = 'check_violation';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(NEW.lines)
    LOOP
        IF jsonb_typeof(v_line) IS DISTINCT FROM 'object'
           OR NOT (v_line->>'category' = ANY (ARRAY['Chalet', 'Food', 'Music', 'Tech', 'Accessories', 'Other']))
           OR jsonb_typeof(v_line->'amount') IS DISTINCT FROM 'number'
           OR (v_line->>'amount')::numeric < 0
           OR (v_line ? 'description' AND jsonb_typeof(v_line->'description') IS DISTINCT FROM 'string') THEN
            RAISE EXCEPTION USING MESSAGE = 'event_budget_line_invalid', DETAIL = json_build_object('line', v_line)::text,
                ERRCODE = 'check_violation';
        END IF;
        v_total := v_total + (v_line->>'amount')::numeric;
    END LOOP;

    NEW.total_cost := v_total;
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_registration_lock_after_close_date()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF public.is_admin() OR NOT private.registration_closed(OLD.event_id) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'DELETE'
       OR (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled') THEN
        RAISE EXCEPTION USING MESSAGE = 'registration_cancel_locked', DETAIL = json_build_object('close_date', (
                SELECT private.toronto_day(e.event_start_date) - (e.x_reg_close_weeks * 7)
                FROM public.events e WHERE e.id = OLD.event_id))::text;
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_event_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION USING MESSAGE = 'event_deletion_forbidden';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_self_privilege_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF (NEW.id = auth.uid() AND OLD.is_admin IS DISTINCT FROM NEW.is_admin) THEN
        IF EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND is_admin = TRUE
        ) THEN
            RAISE EXCEPTION USING MESSAGE = 'own_admin_status_unchangeable';
        ELSE
            RAISE EXCEPTION USING MESSAGE = 'self_admin_promotion_forbidden';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_root_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF OLD.email = 'yulmixalabedaine@gmail.com' AND NEW.is_admin = FALSE THEN
        RAISE EXCEPTION USING MESSAGE = 'root_admin_cannot_be_demoted';
    END IF;
    RETURN NEW;
END;
$function$
;

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

    -- Match entries to this party's attendees by id; the first entry with a given id wins.
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
    ) m;

    DELETE FROM public.attendees a
    WHERE a.party_id = v_party.id
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_to_recordset(v_input) AS r(existing_id uuid) WHERE r.existing_id = a.id
      );

    UPDATE public.attendees a
    SET "position" = r.ord,
        "name" = btrim(r.entry->>'name'),
        "type" = r.entry->>'type',
        participation = r.entry->>'participation',
        is_new_member = COALESCE((r.entry->>'is_new_member')::boolean, false),
        sleeping_preference = COALESCE(r.entry->>'sleeping_preference', ''),
        sleeping_preference_other = COALESCE(r.entry->>'sleeping_preference_other', ''),
        bed_reason = COALESCE(r.entry->>'bed_reason', ''),
        bed_reason_other = COALESCE(r.entry->>'bed_reason_other', ''),
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
           COALESCE(r.entry->>'bed_reason', ''),
           COALESCE(r.entry->>'bed_reason_other', ''),
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
$function$
;
