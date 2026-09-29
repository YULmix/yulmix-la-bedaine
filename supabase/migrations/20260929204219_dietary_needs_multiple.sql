-- #152, #153: an attendee can have several dietary needs, and "Sans produits laitiers" is one.
--
-- attendees.dietary_needs held one value ('' = not answered). It becomes an array of option values
-- ('{}' = not answered), and the database keeps the combinations sensible (ADR 0001):
--   * only known values (dairy_free is new), each at most once, no NULLs;
--   * 'none' ("Aucune restriction") only on its own;
--   * dietary_other (the « Autre » text) is filled exactly when 'other' is chosen.
-- Existing rows: '' → '{}', 'x' → '{x}'. Production had no row breaking the new rules
-- (checked 2026-09-29: '', 'none', and 'other' with its text only).
--
-- save_registration() accepts the array, and still a single string, so a browser holding the
-- previous bundle while this deploys keeps saving. attendees_snapshot() (edit history) builds its
-- JSON from the column, so it records the array without changes.

-- A text[] with no NULL and no repeated element. For the CHECK below: a CHECK can't hold a
-- subquery.
CREATE FUNCTION private.text_array_is_set(p_values text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT count(*) = count(DISTINCT v) FROM unnest(p_values) AS v;
$$;

REVOKE ALL ON FUNCTION private.text_array_is_set(text[]) FROM PUBLIC;
-- Evaluated as the writing role (save_registration() is security invoker).
GRANT EXECUTE ON FUNCTION private.text_array_is_set(text[]) TO authenticated, service_role;

-- The dietary_needs a client sent: an array of values, or (previous app version) one value.
CREATE FUNCTION private.dietary_needs_of(p_value jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE jsonb_typeof(p_value)
        WHEN 'array' THEN ARRAY(SELECT jsonb_array_elements_text(p_value))
        WHEN 'string' THEN CASE WHEN p_value #>> '{}' = '' THEN '{}'::text[] ELSE ARRAY[p_value #>> '{}'] END
        ELSE '{}'::text[]
    END;
$$;

REVOKE ALL ON FUNCTION private.dietary_needs_of(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.dietary_needs_of(jsonb) TO authenticated, service_role;

ALTER TABLE public.attendees DROP CONSTRAINT attendees_dietary_needs_check;

-- « Autre » text left on someone who didn't choose « Autre »: nothing shows it. Cleared so the
-- rule below holds. (Trusted session: the attendee write guard lets migrations through.)
UPDATE public.attendees SET dietary_other = '' WHERE dietary_needs <> 'other' AND dietary_other <> '';

-- The previous app version reads a string here until its tab is reloaded; it only uses the value
-- for display, and saves through save_registration(), which accepts both shapes.
ALTER TABLE public.attendees ALTER COLUMN dietary_needs DROP DEFAULT;
-- squawk-ignore changing-column-type
ALTER TABLE public.attendees ALTER COLUMN dietary_needs TYPE text[] USING CASE WHEN dietary_needs = '' THEN '{}'::text[] ELSE ARRAY[dietary_needs] END;
ALTER TABLE public.attendees ALTER COLUMN dietary_needs SET DEFAULT '{}';

ALTER TABLE public.attendees
    ADD CONSTRAINT attendees_dietary_needs_known
        CHECK (dietary_needs <@ ARRAY['none', 'vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'other']::text[]
               AND private.text_array_is_set(dietary_needs)),
    ADD CONSTRAINT attendees_dietary_none_alone
        CHECK (NOT ('none' = ANY (dietary_needs)) OR cardinality(dietary_needs) = 1),
    ADD CONSTRAINT attendees_dietary_other_text
        CHECK (('other' = ANY (dietary_needs)) = (btrim(dietary_other) <> ''));

COMMENT ON COLUMN public.attendees.dietary_needs IS
    'The attendee''s dietary needs (#153): option values, empty = not answered. ''none'' only alone; ''other'' goes with dietary_other.';

-- ---------------------------------------------------------------------------------------------
-- save_registration(): as in 20260929003000_attendees_table.sql, dietary_needs read through
-- private.dietary_needs_of().

CREATE OR REPLACE FUNCTION public.save_registration(
    p_event_id uuid,
    p_attendees jsonb,
    p_party jsonb DEFAULT '{}'::jsonb,
    p_user_id uuid DEFAULT NULL
)
RETURNS public.user_parties
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
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
        RAISE EXCEPTION 'Les inscriptions sont verrouillées: la date limite pour retirer un participant de cet événement est passée. Le montant dû reste exigible. Contactez un organisateur pour toute exception.';
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
$$;
