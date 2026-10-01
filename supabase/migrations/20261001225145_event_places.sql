-- #193: an event's places, and a venue's layout, are read from the database already assembled.
--
-- Until now the app put them together itself, in three places with three queries and two sort
-- orders (one without the created_at tie-break, so a venue could list differently from one
-- screen to the next), and decided on its own what an override write should be. Now:
--
--   * venue_layout(venue): a venue's locations and places in the one display order (location,
--     then place: sort_order, created_at, id). A location without places is one row with no
--     place, so the Sites editor still shows it.
--   * event_places(event): every place of the event's venue, as the event sees it (#145): its
--     capacity for this event, whether it's excluded, who of this event sleeps there. Built on
--     venue_layout, so both read in the same order. Admins only: overrides are, and a member
--     would otherwise get a merge that silently lacks them.
--   * set_place_override(event, place, excluded, capacity): one place's setting for the event,
--     as a whole state rather than a change, so a retry or a late write lands the same. A
--     capacity equal to the place's own is no override, and a row that changes nothing is
--     deleted (the table's CHECK refuses one). Returns the place as event_places shows it.
--
-- All three are SECURITY INVOKER: the tables' RLS and triggers (enforce_place_override,
-- guard_frozen_layout) still decide; the up-front checks only make the error a clear one.
-- Errors are stable English codes; src/lib/dbErrors.js maps them to French (#102).

CREATE FUNCTION public.venue_layout(p_venue_id uuid)
RETURNS TABLE (
    location_id uuid,
    location_name text,
    location_note text,
    location_sort_order integer,
    place_id uuid,
    label text,
    type text,
    capacity integer,
    place_sort_order integer,
    "position" integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT l.id, l.name, l.note, l.sort_order,
           pl.id, pl.label, pl.type, pl.capacity, pl.sort_order,
           (row_number() OVER (ORDER BY l.sort_order, l.created_at, l.id,
                                        pl.sort_order, pl.created_at, pl.id))::integer
    FROM public.locations l
    LEFT JOIN public.places pl ON pl.location_id = l.id
    WHERE l.venue_id = p_venue_id
    ORDER BY 10;
$$;

COMMENT ON FUNCTION public.venue_layout(uuid) IS
    'A venue''s locations and places in display order (#193); a location without places is one row with a null place.';

CREATE FUNCTION public.event_places(p_event_id uuid)
RETURNS TABLE (
    place_id uuid,
    label text,
    type text,
    location_id uuid,
    location_name text,
    venue_capacity integer,
    capacity integer,
    is_excluded boolean,
    occupants text[],
    "position" integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT vl.place_id, vl.label, vl.type, vl.location_id, vl.location_name,
           vl.capacity,
           COALESCE(o.capacity, vl.capacity),
           COALESCE(o.is_excluded, false),
           COALESCE(occ.names, '{}'::text[]),
           vl."position"
    FROM public.events e
    CROSS JOIN LATERAL public.venue_layout(e.venue_id) vl
    LEFT JOIN public.event_place_overrides o ON o.event_id = e.id AND o.place_id = vl.place_id
    LEFT JOIN LATERAL (
        SELECT array_agg(a.name ORDER BY a.name) AS names
        FROM public.place_assignments pa
        JOIN public.attendees a ON a.id = pa.attendee_id
        JOIN public.user_parties up ON up.id = a.party_id
        WHERE pa.place_id = vl.place_id AND up.event_id = e.id
    ) occ ON true
    WHERE e.id = p_event_id AND vl.place_id IS NOT NULL
    ORDER BY vl."position";
END;
$$;

COMMENT ON FUNCTION public.event_places(uuid) IS
    'Every place of an event''s venue as the event sees it (#193): its capacity for the event, excluded or not, who of the event sleeps there. Admins only.';

CREATE FUNCTION public.set_place_override(
    p_event_id uuid,
    p_place_id uuid,
    p_is_excluded boolean,
    p_capacity integer
)
RETURNS TABLE (
    place_id uuid,
    label text,
    type text,
    location_id uuid,
    location_name text,
    venue_capacity integer,
    capacity integer,
    is_excluded boolean,
    occupants text[],
    "position" integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_event public.events%ROWTYPE;
    v_place_capacity integer;
    v_excluded boolean := COALESCE(p_is_excluded, false);
    v_capacity integer;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;

    SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING MESSAGE = 'event_not_found', ERRCODE = 'no_data_found';
    END IF;
    -- Here too for a write that would change nothing: the guard only sees rows that are written.
    IF v_event.status = 'ARCHIVED' THEN
        RAISE EXCEPTION USING MESSAGE = 'event_layout_frozen', ERRCODE = 'check_violation';
    END IF;

    SELECT pl.capacity INTO v_place_capacity
    FROM public.places pl JOIN public.locations l ON l.id = pl.location_id
    WHERE pl.id = p_place_id AND l.venue_id = v_event.venue_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING MESSAGE = 'place_override_wrong_venue', ERRCODE = 'check_violation';
    END IF;

    v_capacity := NULLIF(p_capacity, v_place_capacity);

    IF NOT v_excluded AND v_capacity IS NULL THEN
        DELETE FROM public.event_place_overrides o
        WHERE o.event_id = p_event_id AND o.place_id = p_place_id;
    ELSE
        INSERT INTO public.event_place_overrides AS o (event_id, place_id, is_excluded, capacity)
        VALUES (p_event_id, p_place_id, v_excluded, v_capacity)
        ON CONFLICT ON CONSTRAINT event_place_overrides_pkey
        DO UPDATE SET is_excluded = EXCLUDED.is_excluded, capacity = EXCLUDED.capacity;
    END IF;

    RETURN QUERY SELECT * FROM public.event_places(p_event_id) ep WHERE ep.place_id = p_place_id;
END;
$$;

COMMENT ON FUNCTION public.set_place_override(uuid, uuid, boolean, integer) IS
    'Sets one place''s whole setting for an event (#193): excluded or not, its capacity (null or the place''s own = none). Returns the place as event_places shows it.';

REVOKE ALL ON FUNCTION public.venue_layout(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_places(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_place_override(uuid, uuid, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_layout(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_places(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_place_override(uuid, uuid, boolean, integer) TO authenticated;
