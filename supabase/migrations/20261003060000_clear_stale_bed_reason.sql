-- #228: an attendee's bed reason only exists while their sleeping preference is « Lit ».
--
--   * save_registration() stores bed_reason / bed_reason_other as '' (the columns' « none », they
--     are NOT NULL) when the attendee's sleeping_preference isn't 'bed', silently. The rest of the
--     function is unchanged from 20260930200216_database_errors_are_codes.sql.
--   * Existing rows are cleaned with a direct UPDATE on attendees. That table has no edit logging
--     (log_registration_edit() fires on user_parties only, and it isn't touched here), and the
--     migration runs as a trusted session, so registration_edits gets no noise entries.

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
$function$
;

UPDATE public.attendees
SET bed_reason = '', bed_reason_other = ''
WHERE sleeping_preference <> 'bed' AND (bed_reason <> '' OR bed_reason_other <> '');
