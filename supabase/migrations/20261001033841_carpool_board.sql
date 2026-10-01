-- The carpool board (#180): members registered for the active event see the lifts offered and
-- needed by the parties that agreed to be listed, with each offer's closest needs (and each
-- need's closest offers) by detour.
--
--   * Consent: transport.carpool_listed, an unchecked-by-default box on the registration form.
--     The board shows the registering member's name and email, so nobody is listed without it.
--   * Members can't read other parties (RLS: own or admin). carpool_board() is their only view of
--     them: SECURITY DEFINER, and it returns the listed fields and nothing else (no notes, no
--     attendees, no amounts).
--   * Detours come from the FSA centres (private.postal_fsa) and the venue's coordinates (below):
--     detour = d(driver, rider) + d(rider, venue) - d(driver, venue), great-circle distances.
--     The board returns FSAs and kilometres, never coordinates.

-- ---------------------------------------------------------------------------------------------
-- Consent to be listed.

ALTER TABLE public.user_parties
    ADD CONSTRAINT user_parties_transport_carpool_listed
        CHECK (NOT (transport ? 'carpool_listed') OR jsonb_typeof(transport->'carpool_listed') = 'boolean');

COMMENT ON CONSTRAINT user_parties_transport_carpool_listed ON public.user_parties IS
    'transport.carpool_listed, when present, is a boolean (#180): the party agreed to be on the carpool board.';

-- ---------------------------------------------------------------------------------------------
-- Where the venue is, for detours: entered by an admin (from a map). Both or neither.

ALTER TABLE public.venues
    ADD COLUMN lat double precision CHECK (lat BETWEEN -90 AND 90),
    ADD COLUMN lng double precision CHECK (lng BETWEEN -180 AND 180),
    ADD CONSTRAINT venues_lat_lng_together CHECK ((lat IS NULL) = (lng IS NULL));

COMMENT ON COLUMN public.venues.lat IS
    'Latitude of the venue (#180), with lng: where carpool detours are measured to. NULL when not entered.';
COMMENT ON COLUMN public.venues.lng IS
    'Longitude of the venue (#180), with lat.';

-- ---------------------------------------------------------------------------------------------
-- Great-circle distance in km (haversine, mean Earth radius).

CREATE FUNCTION private.haversine_km(lat1 double precision, lng1 double precision,
                                     lat2 double precision, lng2 double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
    SELECT 2 * 6371.0088 * asin(sqrt(
        power(sin(radians(lat2 - lat1) / 2), 2)
        + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
    ));
$$;

REVOKE ALL ON FUNCTION private.haversine_km(double precision, double precision, double precision, double precision) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- Who may see the board: an admin, or a member with a registration for the active event that
-- isn't cancelled (waitlisted included). The app asks it to show the nav item; the board checks
-- it again.

CREATE FUNCTION public.can_view_carpool_board()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.is_account_active() AND (
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.user_parties p
            JOIN public.events e ON e.id = p.event_id AND e.is_active
            WHERE p.user_id = auth.uid()
              AND p.status <> 'cancelled'
        )
    );
$$;

ALTER FUNCTION public.can_view_carpool_board() OWNER TO "postgres";

COMMENT ON FUNCTION public.can_view_carpool_board() IS
    'True for an admin, or a member registered (not cancelled, waitlisted included) for the active event (#180): who may see the carpool board.';

REVOKE ALL ON FUNCTION public.can_view_carpool_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_carpool_board() TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- The board: one row per listed party of the active event (opted in, confirmed: not waitlisted,
-- not cancelled; offering or needing a lift), and its matches on the other side.
--
--   entry          a number for the row, in this result only (matches refer to it); not an id
--   kind           'offer' or 'need'
--   is_mine        the caller's own party
--   contact_name   the registering member's full name, or their email
--   contact_email  the registering member's email
--   departure_fsa, departure_place, arrival, departure   as the party entered them, or NULL
--   seats          seats offered, or needed (a need saved before needs had a count: its size)
--   matches        [{ entry, detour_km, distance_km }], the other side's parties, closest first.
--                  Only between parties whose FSA is known; detour_km is NULL when the venue has
--                  no coordinates (then they're sorted by distance_km, driver to rider).
--
-- Anyone else gets the error carpool_board_forbidden.

CREATE FUNCTION public.carpool_board()
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
                     THEN (SELECT count(*)::integer FROM public.attendees a WHERE a.party_id = p.id) END,
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
          AND p.transport->'carpool_listed' = 'true'::jsonb
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

ALTER FUNCTION public.carpool_board() OWNER TO "postgres";

COMMENT ON FUNCTION public.carpool_board() IS
    'The carpool board (#180): the active event''s opted-in, confirmed offer/need parties, with contact name and email, departure, times, seats, and matches by detour. Raises carpool_board_forbidden unless can_view_carpool_board().';

REVOKE ALL ON FUNCTION public.carpool_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carpool_board() TO authenticated;
