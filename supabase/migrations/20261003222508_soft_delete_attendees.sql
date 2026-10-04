-- #237: removing someone from a party marks their attendee row removed (attendees.deleted_at)
-- instead of deleting it, so references to them (#236's « Payé par ») still resolve. NULL means
-- live; a timestamp, never a boolean (organiser decision, as profiles.deleted_at).
--
-- Who ignores removed attendees, and how:
--   * Clients (member and admin): a RESTRICTIVE SELECT policy on attendees hides removed rows from
--     `authenticated`, whatever the permissive policies say. It covers every PostgREST read and
--     embed (parties.ts, the exports, Logistique, the member pages), the security_invoker view
--     attendee_places, and the SECURITY INVOKER functions (save_registration, save_logistics,
--     event_places). Restrictive, so it is ANDed with the permissive policies and survives their
--     being rewritten (#217 splits them) without being touched.
--   * SECURITY DEFINER code and triggers bypass RLS, so the helpers that count or list a party's
--     attendees filter `deleted_at IS NULL` themselves: attendees_snapshot (change history),
--     party_amount_owed (amount owed), event_headcount and party_size (capacity, waitlist,
--     promotion), carpool_board (a need's seats). enforce_place_assignment refuses a removed
--     attendee. The service-role Edge Function (send-party-email) filters its embed.
--   * Admins resolve any attendee, removed or not, by id with attendee_by_id() (SECURITY DEFINER).
--
-- save_registration() soft-deletes the attendees left out of its payload and deletes their place
-- assignments (the cascade used to), through private.remove_party_attendees(): a SECURITY DEFINER
-- helper, because under the restrictive policy an UPDATE that sets deleted_at would make the row
-- invisible to its own writer, which Postgres refuses ("new row violates row-level security").
-- Re-adding someone inserts a new row: a removed attendee's id matches nothing.
--
-- (party_id, position) stays unique among live attendees only: a removed attendee keeps their old
-- position. A partial UNIQUE index can't be deferred, and save_registration() renumbers positions
-- in one statement, so it is an exclusion constraint with a WHERE, deferred like the old one.
--
-- No backfill: no attendee has been removed this way yet.
--
-- Bodies copied from their latest definitions:
--   * save_registration: 20261003060000_clear_stale_bed_reason.sql (#228, bed-reason CASEs kept)
--   * attendees_snapshot: 20260929030708_place_assignments_replace_assigned_bed.sql
--   * party_amount_owed, event_headcount, party_size: 20260929003000_attendees_table.sql
--   * carpool_board: 20261001033841_carpool_board.sql
--   * enforce_place_assignment: 20261003035531_place_assignment_exclusion_lock.sql
-- CREATE OR REPLACE keeps the functions' owners and grants.

ALTER TABLE public.attendees ADD COLUMN deleted_at timestamptz;

COMMENT ON COLUMN public.attendees.deleted_at IS
    'When the attendee was removed from their party (#237); NULL = live. Removed rows are hidden from clients by RLS and ignored by every count.';

-- ---------------------------------------------------------------------------------------------
-- Position: unique among the party's live attendees.

ALTER TABLE public.attendees DROP CONSTRAINT attendees_party_id_position_key;

ALTER TABLE public.attendees ADD CONSTRAINT attendees_live_party_id_position_excl
    EXCLUDE USING btree (party_id WITH =, "position" WITH =) WHERE (deleted_at IS NULL)
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------------------------
-- Clients never read a removed attendee.

CREATE POLICY "Attendees: removed ones are hidden" ON public.attendees
    AS RESTRICTIVE
    FOR SELECT TO authenticated
    USING (deleted_at IS NULL);

-- ---------------------------------------------------------------------------------------------
-- Removing: only from inside save_registration(), for the party it is saving.

CREATE FUNCTION private.remove_party_attendees(p_party_id uuid, p_kept uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- save_registration() sets this after checking the caller may write the party (RLS).
    IF current_setting('bedaine.saving_party', true) IS DISTINCT FROM p_party_id::text THEN
        RAISE EXCEPTION USING MESSAGE = 'attendees_write_through_save_registration', ERRCODE = '42501';
    END IF;

    WITH removed AS (
        UPDATE public.attendees
        SET deleted_at = now()
        WHERE party_id = p_party_id
          AND deleted_at IS NULL
          AND NOT (id = ANY (COALESCE(p_kept, '{}'::uuid[])))
        RETURNING id
    )
    DELETE FROM public.place_assignments pa
    USING removed r
    WHERE pa.attendee_id = r.id;
END;
$$;

REVOKE ALL ON FUNCTION private.remove_party_attendees(uuid, uuid[]) FROM PUBLIC;
-- Called by save_registration() (SECURITY INVOKER) as whoever is saving.
GRANT EXECUTE ON FUNCTION private.remove_party_attendees(uuid, uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- As in 20261003060000_clear_stale_bed_reason.sql, but the attendees left out are soft-deleted,
-- and only live attendees match the payload's ids.

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
$function$
;

-- ---------------------------------------------------------------------------------------------
-- Admins resolve an attendee by id, removed or not (#236's « Payé par »). Members never do.

CREATE FUNCTION public.attendee_by_id(p_attendee_id uuid)
RETURNS TABLE (id uuid, party_id uuid, name text, deleted_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT a.id, a.party_id, a.name, a.deleted_at
    FROM public.attendees a
    WHERE a.id = p_attendee_id;
END;
$$;

REVOKE ALL ON FUNCTION public.attendee_by_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendee_by_id(uuid) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Every count of a party's attendees is of its live ones. These run under SECURITY DEFINER or
-- from SECURITY DEFINER triggers, where RLS doesn't apply.

CREATE OR REPLACE FUNCTION private.attendees_snapshot(p_party_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'type', a.type,
        'participation', a.participation,
        'is_new_member', a.is_new_member,
        'sleeping_preference', a.sleeping_preference,
        'sleeping_preference_other', a.sleeping_preference_other,
        'bed_reason', a.bed_reason,
        'bed_reason_other', a.bed_reason_other,
        'dietary_needs', a.dietary_needs,
        'dietary_other', a.dietary_other
    ) ORDER BY a.position), '[]'::jsonb)
    FROM public.attendees a
    WHERE a.party_id = p_party_id
      AND a.deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION private.party_amount_owed(p_party_id uuid, p_selling_price_whole_event numeric, p_ratio_main_whole numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_selling_price_whole_event IS NULL OR p_selling_price_whole_event <= 0 THEN 0
        ELSE COALESCE(SUM(CEIL(
            CASE
                WHEN a.type IN ('Adult', 'Teenager') THEN
                    (CASE WHEN a.participation = 'Whole' AND NOT a.is_new_member THEN 1 ELSE p_ratio_main_whole END)
                    * (CASE WHEN a.type = 'Teenager' THEN 0.5 ELSE 1 END)
                ELSE 0
            END * p_selling_price_whole_event
        )), 0)
    END
    FROM public.attendees a
    WHERE a.party_id = p_party_id
      AND a.deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION private.event_headcount(p_event_id uuid, p_exclude_party_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(*)::integer
    FROM public.attendees a
    JOIN public.user_parties up ON up.id = a.party_id
    WHERE up.event_id = p_event_id
      AND up.is_waitlisted = FALSE
      AND up.status IN ('registered', 'pending')
      AND up.id IS DISTINCT FROM p_exclude_party_id
      AND a.deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION private.party_size(p_party_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(*)::integer FROM public.attendees WHERE party_id = p_party_id AND deleted_at IS NULL;
$$;

-- As in 20261001033841_carpool_board.sql, but a need without a seat count is its live attendees.
CREATE OR REPLACE FUNCTION public.carpool_board()
RETURNS TABLE (
    entry integer,
    kind text,
    is_mine boolean,
    contact_name text,
    contact_email text,
    departure_fsa text,
    departure_place text,
    arrival text,
    departure text,
    seats integer,
    matches jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    IF NOT public.can_view_carpool_board() THEN
        RAISE EXCEPTION USING MESSAGE = 'carpool_board_forbidden', ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH listed AS (
        SELECT
            (row_number() OVER (ORDER BY p.transport->>'type' DESC,
                                         lower(COALESCE(NULLIF(btrim(pr.full_name), ''), pr.email)),
                                         p.id))::integer AS entry,
            p.transport->>'type' AS kind,
            p.user_id = auth.uid() AS is_mine,
            COALESCE(NULLIF(btrim(pr.full_name), ''), pr.email) AS contact_name,
            pr.email AS contact_email,
            NULLIF(p.transport->>'departure_fsa', '') AS departure_fsa,
            NULLIF(btrim(p.transport->>'departure_place'), '') AS departure_place,
            NULLIF(p.transport->>'arrival', '') AS arrival,
            NULLIF(p.transport->>'departure', '') AS departure,
            COALESCE(
                NULLIF(CASE WHEN jsonb_typeof(p.transport->'seats') = 'number'
                            THEN (p.transport->>'seats')::numeric::integer END, 0),
                CASE WHEN p.transport->>'type' = 'need'
                     THEN (SELECT count(*)::integer FROM public.attendees a WHERE a.party_id = p.id AND a.deleted_at IS NULL) END,
                0
            ) AS seats,
            f.lat,
            f.lng
        FROM public.user_parties p
        JOIN public.events e ON e.id = p.event_id AND e.is_active
        JOIN public.profiles pr ON pr.id = p.user_id AND pr.deleted_at IS NULL
        LEFT JOIN private.postal_fsa f ON f.fsa = p.transport->>'departure_fsa'
        WHERE p.status <> 'cancelled'
          AND NOT COALESCE(p.is_waitlisted, false)
          AND p.transport->>'type' IN ('offer', 'need')
    ),
    venue AS (
        SELECT v.lat, v.lng
        FROM public.events e
        JOIN public.venues v ON v.id = e.venue_id
        WHERE e.is_active AND v.lat IS NOT NULL
    ),
    pairs AS (
        SELECT o.entry AS offer_entry,
               n.entry AS need_entry,
               private.haversine_km(o.lat, o.lng, n.lat, n.lng) AS distance,
               private.haversine_km(o.lat, o.lng, n.lat, n.lng)
                 + private.haversine_km(n.lat, n.lng, v.lat, v.lng)
                 - private.haversine_km(o.lat, o.lng, v.lat, v.lng) AS detour
        FROM listed o
        JOIN listed n ON o.kind = 'offer' AND n.kind = 'need'
        LEFT JOIN venue v ON true
        WHERE o.lat IS NOT NULL AND n.lat IS NOT NULL
    )
    SELECT l.entry, l.kind, l.is_mine, l.contact_name, l.contact_email, l.departure_fsa,
           l.departure_place, l.arrival, l.departure, l.seats,
           COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                          'entry', CASE WHEN l.kind = 'offer' THEN m.need_entry ELSE m.offer_entry END,
                          'detour_km', round(m.detour::numeric, 1),
                          'distance_km', round(m.distance::numeric, 1))
                      ORDER BY COALESCE(m.detour, m.distance), m.distance)
               FROM pairs m
               WHERE (l.kind = 'offer' AND m.offer_entry = l.entry)
                  OR (l.kind = 'need' AND m.need_entry = l.entry)
           ), '[]'::jsonb)
    FROM listed l
    ORDER BY l.entry;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- As in 20261003035531_place_assignment_exclusion_lock.sql, plus: a removed attendee can't be
-- given a place (place_assignment_attendee_removed).

CREATE OR REPLACE FUNCTION private.enforce_place_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_party public.user_parties%ROWTYPE;
    v_event_venue uuid;
    v_place_venue uuid;
BEGIN
    -- A removed attendee (#237) holds no place.
    IF EXISTS (SELECT 1 FROM public.attendees WHERE id = NEW.attendee_id AND deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION USING MESSAGE = 'place_assignment_attendee_removed', ERRCODE = 'check_violation';
    END IF;

    SELECT up.* INTO v_party
    FROM public.attendees a
    JOIN public.user_parties up ON up.id = a.party_id
    WHERE a.id = NEW.attendee_id;

    -- An unknown attendee or place is left to the foreign keys.
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF v_party.status = 'cancelled' OR v_party.is_waitlisted THEN
        RAISE EXCEPTION USING MESSAGE = 'place_assignment_party_inactive', ERRCODE = 'check_violation';
    END IF;

    SELECT l.venue_id INTO v_place_venue
    FROM public.places pl
    JOIN public.locations l ON l.id = pl.location_id
    WHERE pl.id = NEW.place_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT venue_id INTO v_event_venue FROM public.events WHERE id = v_party.event_id;
    IF v_event_venue IS DISTINCT FROM v_place_venue THEN
        RAISE EXCEPTION USING MESSAGE = 'place_assignment_wrong_event', ERRCODE = 'check_violation';
    END IF;

    -- Shared: assignments to one place (a bed holds several people) don't block each other, but
    -- they serialise with enforce_place_override's exclusive lock on this (event, place). Each
    -- statement below then reads a fresh snapshot, so a committed exclusion is visible.
    PERFORM pg_advisory_xact_lock_shared(hashtext(v_party.event_id::text), hashtext(NEW.place_id::text));

    IF EXISTS (SELECT 1 FROM public.event_place_overrides o
               WHERE o.event_id = v_party.event_id AND o.place_id = NEW.place_id AND o.is_excluded) THEN
        RAISE EXCEPTION USING MESSAGE = 'place_assignment_place_excluded', ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;
