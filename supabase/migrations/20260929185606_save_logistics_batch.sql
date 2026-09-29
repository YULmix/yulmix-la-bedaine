-- #150: the Logistique tab saves every party's pending places and admin notes in one call.
--
-- Until now each party card had its own Save, and the browser sent one write per changed
-- attendee plus one for the notes, in parallel: a failure half-way left the party half-saved.
-- save_logistics() applies a whole batch in one transaction, each party in its own
-- subtransaction: a party is saved entirely or not at all, a party the rules reject doesn't stop
-- the others, and the caller learns which parties failed and why, so it can keep their drafts.
--
-- Security invoker: the tables' RLS and triggers (enforce_place_assignment,
-- protect_admin_only_party_fields…) apply exactly as they do to direct writes. The admin check
-- up front only turns a member's call into one clear error instead of one per party.
--
-- p_changes: [{ "party_id": uuid,
--               "admin_notes": text,                       -- optional: absent = unchanged
--               "places": { "<attendee id>": "<place id>" | null } }]   -- null = unassign
-- Returns the parties that were not saved: [{ "party_id", "code", "message", "details" }],
-- message being the error code the app maps to French (src/lib/dbErrors.js). [] = all saved.

CREATE FUNCTION public.save_logistics(p_changes jsonb)
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

            IF v_party ? 'admin_notes' THEN
                UPDATE public.user_parties
                SET admin_notes = v_party->>'admin_notes'
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
    'Saves the Logistique tab''s pending places and admin notes (#150), each party all or nothing. Returns the parties not saved, with their error.';

REVOKE ALL ON FUNCTION public.save_logistics(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_logistics(jsonb) TO authenticated;
