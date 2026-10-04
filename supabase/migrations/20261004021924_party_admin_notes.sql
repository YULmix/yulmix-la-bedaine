-- #227: the organisers' private notes on a registration move out of user_parties into their own
-- table, which only admins can read or write. The own-row SELECT policy on user_parties exposed
-- every column, so a member's own admin_notes came back with their party.
--
--   * party_admin_notes: one row per party (none = no notes). Admins read and write it (is_admin()
--     until the edition roles of #217 land); members have no access of any kind.
--   * The existing non-empty notes are copied over, then user_parties.admin_notes is dropped.
--   * save_logistics() keeps its payload (a per-party admin_notes, absent = unchanged) and writes
--     the new table.
--   * The change history logs a note change as before: key admin_notes, { old, new }. A trigger on
--     party_admin_notes logs it; inside save_logistics() it goes in that party's single entry with
--     its places and message_to_participants, through the transaction-local setting
--     bedaine.logistics_changes ({ party_id, changes }), which replaces #188's
--     bedaine.place_changes. A refused party's subtransaction rolls back the setting with it.
--   * protect_admin_only_party_fields() and log_registration_edit() stop referencing the column.
--
-- Bodies copied from their latest definitions on main:
--   * save_logistics, log_registration_edit: 20261003152504_place_assignment_history.sql
--   * protect_admin_only_party_fields: 20261003045014_message_to_participants.sql
-- CREATE OR REPLACE keeps the functions' owners and grants.

-- ---------------------------------------------------------------------------------------------
-- The table.

CREATE TABLE public.party_admin_notes (
    party_id uuid PRIMARY KEY REFERENCES public.user_parties (id) ON DELETE CASCADE,
    notes text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.party_admin_notes IS
    'The organisers'' private notes on a registration (#227). Admins only: members never read them, not even their own party''s.';

ALTER TABLE public.party_admin_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Party Admin Notes: Admin full access" ON public.party_admin_notes
    FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.party_admin_notes FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.party_admin_notes TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The notes as they are now. No history entry: nothing changed.

INSERT INTO public.party_admin_notes (party_id, notes)
SELECT id, admin_notes
FROM public.user_parties
WHERE COALESCE(admin_notes, '') <> '';

-- ---------------------------------------------------------------------------------------------
-- updated_at, and the change history of a note.

CREATE FUNCTION private.touch_party_admin_notes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- A note change, in save_logistics(): added to the entry it writes for the party; else its own.
-- No entry for a deleted party's notes (they go with the party).
CREATE FUNCTION private.log_party_admin_notes_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old text;
    v_change jsonb;
    v_pending jsonb;
BEGIN
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.notes END;
    -- No notes and empty notes are the same: the copy above left out empty ones, so '' saved
    -- over a missing row logs nothing, as '' over '' did.
    IF COALESCE(v_old, '') = COALESCE(NEW.notes, '') THEN
        RETURN NULL;
    END IF;
    v_change := jsonb_build_object('admin_notes', jsonb_build_object('old', v_old, 'new', NEW.notes));

    v_pending := NULLIF(current_setting('bedaine.logistics_changes', true), '')::jsonb;
    IF v_pending->>'party_id' = NEW.party_id::text THEN
        PERFORM set_config('bedaine.logistics_changes',
            jsonb_set(v_pending, '{changes}', (v_pending->'changes') || v_change)::text, true);
    ELSE
        INSERT INTO public.registration_edits (registration_id, edited_by, changes)
        VALUES (NEW.party_id, auth.uid(), v_change);
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.touch_party_admin_notes() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.log_party_admin_notes_edit() FROM PUBLIC;

CREATE TRIGGER trg_touch_party_admin_notes
    BEFORE UPDATE ON public.party_admin_notes
    FOR EACH ROW EXECUTE FUNCTION private.touch_party_admin_notes();

CREATE TRIGGER trg_log_party_admin_notes_edit
    AFTER INSERT OR UPDATE OF notes ON public.party_admin_notes
    FOR EACH ROW EXECUTE FUNCTION private.log_party_admin_notes_edit();

-- ---------------------------------------------------------------------------------------------
-- As in 20261003045014_message_to_participants.sql, without admin_notes.
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
        NEW.message_to_participants := NULL;
    ELSE
        NEW.payment_status := OLD.payment_status;
        NEW.message_to_participants := OLD.message_to_participants;
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- As in 20261003152504_place_assignment_history.sql, with the notes in party_admin_notes and the
-- party's pending history in bedaine.logistics_changes:
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
    v_pending jsonb;
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

            -- This party's history entry, collected as it saves: its places here, its notes by
            -- party_admin_notes' trigger. log_registration_edit takes it when the update below
            -- writes an entry (and clears it), else it's written at the end.
            PERFORM set_config('bedaine.logistics_changes',
                jsonb_build_object('party_id', v_party_id, 'changes', '{}'::jsonb)::text, true);

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

            v_place_changes := private.place_changes(v_places_before, private.party_places_snapshot(v_party_id));
            IF v_place_changes IS NOT NULL THEN
                v_pending := current_setting('bedaine.logistics_changes', true)::jsonb;
                PERFORM set_config('bedaine.logistics_changes',
                    jsonb_set(v_pending, '{changes,places}', v_place_changes)::text, true);
            END IF;

            -- The organisers' notes (#227); an absent key keeps them.
            IF v_party ? 'admin_notes' THEN
                INSERT INTO public.party_admin_notes (party_id, notes)
                VALUES (v_party_id, v_party->>'admin_notes')
                ON CONFLICT (party_id) DO UPDATE SET notes = EXCLUDED.notes
                WHERE public.party_admin_notes.notes IS DISTINCT FROM EXCLUDED.notes;
            END IF;

            IF v_party ? 'message_to_participants' THEN
                UPDATE public.user_parties
                SET message_to_participants = v_party->>'message_to_participants'
                WHERE id = v_party_id;
            END IF;

            v_pending := NULLIF(current_setting('bedaine.logistics_changes', true), '')::jsonb;
            IF v_pending IS NOT NULL AND v_pending->'changes' <> '{}'::jsonb THEN
                INSERT INTO public.registration_edits (registration_id, edited_by, changes)
                VALUES (v_party_id, auth.uid(), v_pending->'changes');
            END IF;
            PERFORM set_config('bedaine.logistics_changes', '', true);
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
    'Saves the Logistique tab''s pending places, admin notes (party_admin_notes, #227) and messages to participants (#150, #216), each party all or nothing, with one change-history entry per party saved (#188). Returns the parties not saved, with their error.';

-- ---------------------------------------------------------------------------------------------
-- As in 20261003152504_place_assignment_history.sql, without admin_notes (party_admin_notes logs
-- its own), and with the whole pending entry save_logistics() left for this party.
CREATE OR REPLACE FUNCTION public.log_registration_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    changes_json JSONB := '{}'::JSONB;
    v_attendees_after JSONB;
    v_pending JSONB;
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
    -- save_logistics() left this party's place and note changes: they go in this entry (#188, #227).
    v_pending := NULLIF(current_setting('bedaine.logistics_changes', true), '')::jsonb;
    IF v_pending->>'party_id' = NEW.id::text THEN
        changes_json = changes_json || (v_pending->'changes');
        PERFORM set_config('bedaine.logistics_changes', '', true);
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
-- Every function that read the column is redefined above: drop it. The app live during the
-- deploy never names it (it reads user_parties with *, and saves notes through save_logistics).
-- squawk-ignore ban-drop-column
ALTER TABLE public.user_parties DROP COLUMN admin_notes;
