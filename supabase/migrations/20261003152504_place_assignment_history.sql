-- #188: place (bed) assignments are logged in the change history (registration_edits), as
-- changes.places = { old: [...], new: [...] }, one entry per attendee whose place changed:
-- { attendee_id, attendee_name, place_id, label }, label « <location> · <place> » as it was at the
-- time, place_id and label null for « unassigned ». Old and new list the same attendees, in the
-- same order.
--
--   * save_logistics() logs, per party it saves, the attendees whose place it changed. The same
--     save's admin_notes and message_to_participants go in the SAME row: save_logistics leaves the
--     party's place changes in a transaction-local setting (bedaine.place_changes) for
--     log_registration_edit() to pick up, and writes the row itself when no update of the party
--     came to take them. A refused party's subtransaction rolls back, its row and setting with it.
--   * A venue change that clears an event's assignments logs one row per party that had any:
--     every assigned attendee to unassigned, with changes.places.reason = 'venue_changed'.
--   * Not logged: the archive freeze (it moves assignments to a copy of the same layout, and the
--     venue-change trigger leaves it alone), and the clears from a cancellation or a removed
--     attendee, whose own history entry already says it.
--
-- Rows are authored by auth.uid(), the admin. The read policy is unchanged: a member reads only
-- the rows they authored, so they don't see these.
--
-- Bodies copied from their latest definitions:
--   * save_logistics, log_registration_edit: 20261003045014_message_to_participants.sql
--   * clear_event_places_on_venue_change: 20260929181259_freeze_archived_event_layout.sql
-- CREATE OR REPLACE keeps the functions' owners and grants.

-- ---------------------------------------------------------------------------------------------
-- A party's attendees and their place, labels frozen as they are now, in attendee order.

CREATE FUNCTION private.party_places_snapshot(p_party_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'attendee_id', a.id,
        'attendee_name', a.name,
        'place_id', pa.place_id,
        'label', CASE WHEN pa.place_id IS NULL THEN NULL ELSE l.name || ' · ' || pl.label END
    ) ORDER BY a.position), '[]'::jsonb)
    FROM public.attendees a
    LEFT JOIN public.place_assignments pa ON pa.attendee_id = a.id
    LEFT JOIN public.places pl ON pl.id = pa.place_id
    LEFT JOIN public.locations l ON l.id = pl.location_id
    WHERE a.party_id = p_party_id;
$$;

-- The changes.places of two snapshots of one party: the attendees whose place differs, or null.
CREATE FUNCTION private.place_changes(p_before jsonb, p_after jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
        'old', jsonb_agg(b.entry ORDER BY b.ord),
        'new', jsonb_agg(a.entry ORDER BY b.ord)
    ) END
    FROM jsonb_array_elements(p_before) WITH ORDINALITY AS b(entry, ord)
    JOIN jsonb_array_elements(p_after) AS a(entry) ON a.entry->'attendee_id' = b.entry->'attendee_id'
    WHERE a.entry->'place_id' IS DISTINCT FROM b.entry->'place_id';
$$;

REVOKE ALL ON FUNCTION private.party_places_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.place_changes(jsonb, jsonb) FROM PUBLIC;
-- Called by save_logistics() as the admin saving (SECURITY INVOKER), and by triggers.
GRANT EXECUTE ON FUNCTION private.party_places_snapshot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.place_changes(jsonb, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- As in 20261003045014_message_to_participants.sql, plus the place changes' history:
--
-- p_changes: [{ "party_id": uuid,
--               "admin_notes": text,                       -- optional: absent = unchanged
--               "message_to_participants": text,           -- optional: absent = unchanged
--               "places": { "<attendee id>": "<place id>" | null } }]   -- null = unassign
CREATE OR REPLACE FUNCTION public.save_logistics(p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_party jsonb;
    v_party_id uuid;
    v_place record;
    v_places_before jsonb;
    v_place_changes jsonb;
    v_failed jsonb := '[]'::jsonb;
    v_state text;
    v_message text;
    v_details text;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION USING MESSAGE = 'logistics_changes_invalid', ERRCODE = '22023';
    END IF;

    FOR v_party IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
        v_party_id := NULL;
        BEGIN
            v_party_id := (v_party->>'party_id')::uuid;

            IF NOT EXISTS (SELECT 1 FROM public.user_parties WHERE id = v_party_id) THEN
                RAISE EXCEPTION USING MESSAGE = 'logistics_party_not_found', ERRCODE = 'no_data_found';
            END IF;

            -- Two saves of one party take turns, so the before snapshot is what this save changes.
            PERFORM 1 FROM public.user_parties WHERE id = v_party_id FOR UPDATE;
            v_places_before := private.party_places_snapshot(v_party_id);

            FOR v_place IN
                SELECT key::uuid AS attendee_id, CASE WHEN jsonb_typeof(value) = 'null' THEN NULL ELSE (value #>> '{}')::uuid END AS place_id
                FROM jsonb_each(COALESCE(v_party->'places', '{}'::jsonb))
            LOOP
                IF NOT EXISTS (SELECT 1 FROM public.attendees
                               WHERE id = v_place.attendee_id AND party_id = v_party_id) THEN
                    RAISE EXCEPTION USING MESSAGE = 'logistics_attendee_not_in_party', ERRCODE = 'check_violation';
                END IF;

                -- One place per attendee (place_assignments.attendee_id is unique).
                IF v_place.place_id IS NULL THEN
                    DELETE FROM public.place_assignments WHERE attendee_id = v_place.attendee_id;
                ELSE
                    INSERT INTO public.place_assignments (attendee_id, place_id)
                    VALUES (v_place.attendee_id, v_place.place_id)
                    ON CONFLICT (attendee_id) DO UPDATE SET place_id = EXCLUDED.place_id
                    WHERE public.place_assignments.place_id IS DISTINCT FROM EXCLUDED.place_id;
                END IF;
            END LOOP;

            -- The places' history goes in the texts' entry when the update below writes one
            -- (log_registration_edit takes it from the setting and clears it), else in its own.
            v_place_changes := private.place_changes(v_places_before, private.party_places_snapshot(v_party_id));
            IF v_place_changes IS NOT NULL THEN
                PERFORM set_config('bedaine.place_changes',
                    jsonb_build_object('party_id', v_party_id, 'places', v_place_changes)::text, true);
            END IF;

            -- Both texts in one update, so one change-history entry; an absent key keeps the column.
            IF v_party ? 'admin_notes' OR v_party ? 'message_to_participants' THEN
                UPDATE public.user_parties
                SET admin_notes = CASE WHEN v_party ? 'admin_notes'
                                       THEN v_party->>'admin_notes' ELSE admin_notes END,
                    message_to_participants = CASE WHEN v_party ? 'message_to_participants'
                                                   THEN v_party->>'message_to_participants' ELSE message_to_participants END
                WHERE id = v_party_id;
            END IF;

            IF v_place_changes IS NOT NULL AND COALESCE(current_setting('bedaine.place_changes', true), '') <> '' THEN
                INSERT INTO public.registration_edits (registration_id, edited_by, changes)
                VALUES (v_party_id, auth.uid(), jsonb_build_object('places', v_place_changes));
                PERFORM set_config('bedaine.place_changes', '', true);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT, v_details = PG_EXCEPTION_DETAIL;
            v_failed := v_failed || jsonb_build_array(jsonb_build_object(
                'party_id', COALESCE(v_party_id::text, v_party->>'party_id'),
                'code', v_state,
                'message', v_message,
                'details', NULLIF(v_details, '')
            ));
        END;
    END LOOP;

    RETURN v_failed;
END;
$$;

COMMENT ON FUNCTION public.save_logistics(jsonb) IS
    'Saves the Logistique tab''s pending places, admin notes and messages to participants (#150, #216), each party all or nothing, with one change-history entry per party saved (#188). Returns the parties not saved, with their error.';

-- ---------------------------------------------------------------------------------------------
-- As in 20261003045014_message_to_participants.sql, plus the place changes save_logistics() left
-- for this party.
CREATE OR REPLACE FUNCTION public.log_registration_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    changes_json JSONB := '{}'::JSONB;
    v_attendees_after JSONB;
    v_place_changes JSONB;
BEGIN
    IF private.is_creating_party(NEW.id) THEN
        INSERT INTO public.registration_edits (registration_id, edited_by, changes)
        VALUES (NEW.id, auth.uid(), jsonb_build_object('created', jsonb_build_object(
            'old', NULL,
            'new', jsonb_build_object(
                'attendees', private.attendees_snapshot(NEW.id),
                'status', NEW.status,
                'is_waitlisted', NEW.is_waitlisted,
                'calculated_amount_owed', NEW.calculated_amount_owed
            )
        )));
        RETURN NEW;
    END IF;

    -- save_registration() left the attendees as they were before the save.
    IF current_setting('bedaine.saving_party', true) = NEW.id::text THEN
        v_attendees_after := private.attendees_snapshot(NEW.id);
        IF current_setting('bedaine.attendees_before', true)::jsonb IS DISTINCT FROM v_attendees_after THEN
            changes_json = jsonb_set(changes_json, '{attendees}', jsonb_build_object(
                'old', current_setting('bedaine.attendees_before', true)::jsonb,
                'new', v_attendees_after
            ));
        END IF;
    END IF;
    -- save_logistics() left this party's place changes: they go in this entry (#188).
    v_place_changes := NULLIF(current_setting('bedaine.place_changes', true), '')::jsonb;
    IF v_place_changes->>'party_id' = NEW.id::text THEN
        changes_json = jsonb_set(changes_json, '{places}', v_place_changes->'places');
        PERFORM set_config('bedaine.place_changes', '', true);
    END IF;
    IF OLD.logistics IS DISTINCT FROM NEW.logistics THEN
        changes_json = jsonb_set(changes_json, '{logistics}', jsonb_build_object('old', OLD.logistics, 'new', NEW.logistics));
    END IF;
    IF OLD.transport IS DISTINCT FROM NEW.transport THEN
        changes_json = jsonb_set(changes_json, '{transport}', jsonb_build_object('old', OLD.transport, 'new', NEW.transport));
    END IF;
    IF OLD.music_requests IS DISTINCT FROM NEW.music_requests THEN
        changes_json = jsonb_set(changes_json, '{music_requests}', jsonb_build_object('old', OLD.music_requests, 'new', NEW.music_requests));
    END IF;
    IF OLD.message_to_organizers IS DISTINCT FROM NEW.message_to_organizers THEN
        changes_json = jsonb_set(changes_json, '{message_to_organizers}', jsonb_build_object('old', OLD.message_to_organizers, 'new', NEW.message_to_organizers));
    END IF;
    IF OLD.confirmation_message IS DISTINCT FROM NEW.confirmation_message THEN
        changes_json = jsonb_set(changes_json, '{confirmation_message}', jsonb_build_object('old', OLD.confirmation_message, 'new', NEW.confirmation_message));
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        changes_json = jsonb_set(changes_json, '{status}', jsonb_build_object('old', OLD.status, 'new', NEW.status));
    END IF;
    IF OLD.calculated_amount_owed IS DISTINCT FROM NEW.calculated_amount_owed THEN
        changes_json = jsonb_set(changes_json, '{calculated_amount_owed}', jsonb_build_object('old', OLD.calculated_amount_owed, 'new', NEW.calculated_amount_owed));
    END IF;
    IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
        changes_json = jsonb_set(changes_json, '{payment_status}', jsonb_build_object('old', OLD.payment_status, 'new', NEW.payment_status));
    END IF;
    IF OLD.is_waitlisted IS DISTINCT FROM NEW.is_waitlisted THEN
        changes_json = jsonb_set(changes_json, '{is_waitlisted}', jsonb_build_object('old', OLD.is_waitlisted, 'new', NEW.is_waitlisted));
    END IF;
    IF OLD.admin_notes IS DISTINCT FROM NEW.admin_notes THEN
        changes_json = jsonb_set(changes_json, '{admin_notes}', jsonb_build_object('old', OLD.admin_notes, 'new', NEW.admin_notes));
    END IF;
    IF OLD.message_to_participants IS DISTINCT FROM NEW.message_to_participants THEN
        changes_json = jsonb_set(changes_json, '{message_to_participants}', jsonb_build_object('old', OLD.message_to_participants, 'new', NEW.message_to_participants));
    END IF;

    IF changes_json != '{}'::JSONB THEN
        INSERT INTO public.registration_edits (registration_id, edited_by, changes)
        VALUES (NEW.id, auth.uid(), changes_json);
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- As in 20260929181259_freeze_archived_event_layout.sql, plus one history entry per party whose
-- assignments the venue change clears.
CREATE OR REPLACE FUNCTION private.clear_event_places_on_venue_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF current_setting('bedaine.freezing_event', true) = NEW.id::text THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.registration_edits (registration_id, edited_by, changes)
    SELECT up.id, auth.uid(), jsonb_build_object('places', jsonb_build_object(
        'old', s.assigned,
        'new', (SELECT jsonb_agg(x.entry || '{"place_id": null, "label": null}'::jsonb ORDER BY x.ord)
                FROM jsonb_array_elements(s.assigned) WITH ORDINALITY AS x(entry, ord)),
        'reason', 'venue_changed'
    ))
    FROM public.user_parties up
    CROSS JOIN LATERAL (
        SELECT jsonb_agg(x.entry ORDER BY x.ord) AS assigned
        FROM jsonb_array_elements(private.party_places_snapshot(up.id)) WITH ORDINALITY AS x(entry, ord)
        WHERE x.entry->>'place_id' IS NOT NULL
    ) s
    WHERE up.event_id = NEW.id AND s.assigned IS NOT NULL;

    DELETE FROM public.place_assignments pa
    USING public.attendees a, public.user_parties up
    WHERE a.id = pa.attendee_id AND up.id = a.party_id AND up.event_id = NEW.id;

    DELETE FROM public.event_place_overrides WHERE event_id = NEW.id;
    RETURN NULL;
END;
$$;
