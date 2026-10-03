-- #216: a message from the organisers to a registration, shown to its member in their
-- « Logistique » card. admin_notes stays the organisers' private notes: this is a new column, so
-- no existing note gets published.
--
--   * Admin-only to write, like admin_notes (#94): protect_admin_only_party_fields() ignores what
--     a member sends (null on insert, the stored value on update). It doesn't raise.
--   * Members read it through the existing own-row SELECT policy.
--   * save_logistics() takes it per party, absent = unchanged, same contract as admin_notes.
--   * log_registration_edit() logs it like admin_notes.
-- CREATE OR REPLACE keeps the functions' owners and grants.

ALTER TABLE public.user_parties ADD COLUMN message_to_participants text;

COMMENT ON COLUMN public.user_parties.message_to_participants IS
    'Message from the organisers to the registration''s member, shown in their Logistique card (#216). Admin-only to write.';

-- As in 20260929003000_attendees_table.sql, plus message_to_participants.
CREATE OR REPLACE FUNCTION public.protect_admin_only_party_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' AND auth.role() IS DISTINCT FROM 'anon' THEN
        RETURN NEW;
    END IF;
    IF public.is_admin() THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.payment_status := 'unpaid';
        NEW.admin_notes := NULL;
        NEW.message_to_participants := NULL;
    ELSE
        NEW.payment_status := OLD.payment_status;
        NEW.admin_notes := OLD.admin_notes;
        NEW.message_to_participants := OLD.message_to_participants;
    END IF;
    RETURN NEW;
END;
$$;

-- As in 20260929185606_save_logistics_batch.sql, plus message_to_participants:
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

            -- Both texts in one update, so one change-history entry; an absent key keeps the column.
            IF v_party ? 'admin_notes' OR v_party ? 'message_to_participants' THEN
                UPDATE public.user_parties
                SET admin_notes = CASE WHEN v_party ? 'admin_notes'
                                       THEN v_party->>'admin_notes' ELSE admin_notes END,
                    message_to_participants = CASE WHEN v_party ? 'message_to_participants'
                                                   THEN v_party->>'message_to_participants' ELSE message_to_participants END
                WHERE id = v_party_id;
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
    'Saves the Logistique tab''s pending places, admin notes and messages to participants (#150, #216), each party all or nothing. Returns the parties not saved, with their error.';

-- As in 20261001180052_log_registration_creation.sql, plus message_to_participants.
CREATE OR REPLACE FUNCTION public.log_registration_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    changes_json JSONB := '{}'::JSONB;
    v_attendees_after JSONB;
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
