-- #145 (part of #137): shared venues. A venue holds the locations and places; events reuse it.
--
-- Until now each event had its own locations (event_locations.event_id), so a venue hosting
-- several editions had its rooms typed in again every time. Now:
--
--   * venues: where an event takes place (name, address). Archived, never deleted: admins may
--     not DELETE a venue (no grant), they set archived_at.
--   * events.venue_id: the one venue an event uses (NULL until one is picked). The address moves
--     from events.venue_address to venues.address; the column is dropped.
--   * locations (was event_locations) belong to a venue; places (was event_places) are unchanged.
--   * event_place_overrides: what is particular to one event at its venue: a place excluded this
--     edition, or its capacity for this event. Excluding a place an attendee of that event holds is
--     refused (decided 2026-09-29): the admin moves them first.
--   * place_assignments stay per event: an attendee holds a place of their event's venue, not an
--     excluded one. Changing an event's venue clears its assignments and overrides.
--   * attendee_places takes the event from the attendee's party, since a place is no longer tied
--     to one event.
--
-- Existing data: every event with locations (or an address) gets its own venue, named after it
-- ("Usine Stanstead" for Bédaine 2026), its locations move there, and assignments are untouched.
-- A venue whose event is archived is created archived.
--
-- Not here: archived events keeping the layout they had when a venue changes (#148). Until then,
-- a place an archived event's attendee held can't be deleted (the foreign key refuses it), which
-- is the same rule as today.
--
-- Deployed in one step with the frontend that reads the new names: a tab still on the previous
-- frontend fails to load or save sleeping places until it reloads (as in #114).
--
-- Errors are stable English codes; src/lib/dbErrors.js maps them to French (#102).

-- ---------------------------------------------------------------------------------------------
-- Venues, and the event's venue.

CREATE TABLE public.venues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (btrim(name) <> ''),
    address text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.venues IS
    'Where an event takes place (#145): name, address, and its locations. Reused across events; archived, never deleted.';
COMMENT ON COLUMN public.venues.archived_at IS
    'Set when the venue is archived: it is no longer offered for an event. Events that used it keep it.';

-- NO ACTION: a venue in use can't be deleted (nobody may delete one anyway, see the grants).
ALTER TABLE public.events ADD COLUMN venue_id uuid REFERENCES public.venues (id);

CREATE INDEX events_venue_id_idx ON public.events (venue_id);

COMMENT ON COLUMN public.events.venue_id IS
    'The venue the event takes place at (#145); NULL until one is picked. Its address is the event''s address.';

-- ---------------------------------------------------------------------------------------------
-- Locations and places lose "event_" in their names: they belong to a venue now. What reads or
-- guards the event link goes first; it is recreated below.

DROP VIEW public.attendee_places;
DROP TRIGGER trg_keep_location_in_its_event ON public.event_locations;
DROP TRIGGER trg_keep_place_in_its_event ON public.event_places;
DROP FUNCTION private.keep_places_in_their_event();

-- squawk-ignore renaming-table
ALTER TABLE public.event_locations RENAME TO locations;
-- squawk-ignore renaming-table
ALTER TABLE public.event_places RENAME TO places;

-- Constraint (and so primary key index) names follow the tables.
DO $$
DECLARE
    v_constraint record;
BEGIN
    FOR v_constraint IN
        SELECT c.conrelid::regclass AS tbl, c.conname,
               regexp_replace(c.conname, '^event_', '') AS new_name
        FROM pg_constraint c
        WHERE c.conrelid IN ('public.locations'::regclass, 'public.places'::regclass)
          AND c.conname LIKE 'event\_%'
    LOOP
        EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
                       v_constraint.tbl, v_constraint.conname, v_constraint.new_name);
    END LOOP;
END;
$$;

ALTER INDEX public.event_places_location_id_idx RENAME TO places_location_id_idx;

ALTER POLICY "Event Locations: Admin full access" ON public.locations
    RENAME TO "Locations: Admin full access";
ALTER POLICY "Event Locations: Member reads where they sleep" ON public.locations
    RENAME TO "Locations: Member reads where they sleep";
ALTER POLICY "Event Places: Admin full access" ON public.places
    RENAME TO "Places: Admin full access";
ALTER POLICY "Event Places: Member reads where they sleep" ON public.places
    RENAME TO "Places: Member reads where they sleep";

COMMENT ON TABLE public.locations IS
    'Where people sleep at a venue (#112, #145): a room, the yard, a campground… Holds places.';
COMMENT ON TABLE public.places IS
    'A bed, a sofa, floor space… inside a location (#112): capacity is how many people it is meant for; exceeding it is allowed, the UI warns. An event may exclude it or change its capacity (event_place_overrides).';

-- A venue's locations go with it (a venue is never deleted in practice; see the grants).
ALTER TABLE public.locations ADD COLUMN venue_id uuid REFERENCES public.venues (id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Existing data: one venue per event that has locations or an address.

DO $$
DECLARE
    -- Bédaine 2026 in production (see 20260929124145_usine_stanstead_rooms.sql).
    c_usine_event constant uuid := '1f7127f9-ac51-481a-91f8-b887f2e1ae6e';
    v_event record;
    v_venue uuid;
BEGIN
    FOR v_event IN
        SELECT e.id, e.theme, e.status, NULLIF(btrim(e.venue_address), '') AS address
        FROM public.events e
        WHERE EXISTS (SELECT 1 FROM public.locations l WHERE l.event_id = e.id)
           OR NULLIF(btrim(e.venue_address), '') IS NOT NULL
        ORDER BY e.created_at
    LOOP
        INSERT INTO public.venues (name, address, archived_at)
        VALUES (
            CASE WHEN v_event.id = c_usine_event THEN 'Usine Stanstead' ELSE v_event.theme END,
            v_event.address,
            CASE WHEN v_event.status = 'ARCHIVED' THEN now() END
        )
        RETURNING id INTO v_venue;

        UPDATE public.events SET venue_id = v_venue WHERE id = v_event.id;
        UPDATE public.locations SET venue_id = v_venue WHERE event_id = v_event.id;
    END LOOP;
END;
$$;

-- Every location was moved above (a location always had an event).
-- squawk-ignore adding-not-nullable-field
ALTER TABLE public.locations ALTER COLUMN venue_id SET NOT NULL;

-- squawk-ignore ban-drop-column
ALTER TABLE public.locations DROP COLUMN event_id;

CREATE INDEX locations_venue_id_idx ON public.locations (venue_id);

-- squawk-ignore ban-drop-column
ALTER TABLE public.events DROP COLUMN venue_address;

-- ---------------------------------------------------------------------------------------------
-- What is particular to one event at its venue.

CREATE TABLE public.event_place_overrides (
    event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    place_id uuid NOT NULL REFERENCES public.places (id) ON DELETE CASCADE,
    -- Unavailable this edition: not offered, and nobody of this event may hold it.
    is_excluded boolean NOT NULL DEFAULT false,
    -- This event's capacity for the place, instead of places.capacity. NULL: the place's own.
    capacity integer CHECK (capacity >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, place_id),
    -- A row that changes nothing is deleted instead.
    CHECK (is_excluded OR capacity IS NOT NULL)
);

CREATE INDEX event_place_overrides_place_id_idx ON public.event_place_overrides (place_id);

COMMENT ON TABLE public.event_place_overrides IS
    'A place excluded from one event, or its capacity for that event (#145). The venue itself is unchanged.';

-- ---------------------------------------------------------------------------------------------
-- Access. Admins read and write everything. Anyone who can read an event (its RLS: active and
-- archived events, to anon too) can read its venue, for the address. Locations and places keep
-- their policies: a member reads the ones their own attendees hold.

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_place_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Venues: Admin full access" ON public.venues
    FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Venues: Read with their events" ON public.venues
    FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public.events e WHERE e.venue_id = venues.id));

CREATE POLICY "Event Place Overrides: Admin full access" ON public.event_place_overrides
    FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.venues, public.event_place_overrides FROM anon, authenticated, service_role;
-- No DELETE on venues: they are archived.
GRANT SELECT ON TABLE public.venues TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.venues TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_place_overrides TO authenticated;
-- The send-party-email Edge Function reads the event's address.
GRANT SELECT ON TABLE public.venues, public.event_place_overrides TO service_role;

-- ---------------------------------------------------------------------------------------------
-- The view. security_invoker, so it shows exactly what the tables' RLS lets the reader see. The
-- event comes from the attendee's party.

CREATE VIEW public.attendee_places WITH (security_invoker = true) AS
SELECT pa.attendee_id,
       a.party_id,
       a.name AS attendee_name,
       up.event_id,
       l.id AS location_id,
       l.name AS location_name,
       pl.id AS place_id,
       pl.label AS place_label,
       pl.type AS place_type,
       l.name || ' · ' || pl.label AS bed_label
FROM public.place_assignments pa
JOIN public.attendees a ON a.id = pa.attendee_id
JOIN public.user_parties up ON up.id = a.party_id
JOIN public.places pl ON pl.id = pa.place_id
JOIN public.locations l ON l.id = pl.location_id;

COMMENT ON VIEW public.attendee_places IS
    'Where each assigned attendee sleeps, with the "<location> · <place>" label shown to people (#112).';

REVOKE ALL ON TABLE public.attendee_places FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.attendee_places TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Rules.

-- Only an attendee of an active party, to a place of their event's venue that the event hasn't
-- excluded. place_assignment_wrong_event keeps its code: the place isn't part of this event.
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

    IF EXISTS (SELECT 1 FROM public.event_place_overrides o
               WHERE o.event_id = v_party.event_id AND o.place_id = NEW.place_id AND o.is_excluded) THEN
        RAISE EXCEPTION USING MESSAGE = 'place_assignment_place_excluded', ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- An override is about a place of the event's venue, and excluding a place someone of that
-- event holds is refused.
CREATE FUNCTION private.enforce_place_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT venue_id FROM public.events WHERE id = NEW.event_id) IS DISTINCT FROM
       (SELECT l.venue_id FROM public.places pl JOIN public.locations l ON l.id = pl.location_id
        WHERE pl.id = NEW.place_id) THEN
        RAISE EXCEPTION USING MESSAGE = 'place_override_wrong_venue', ERRCODE = 'check_violation';
    END IF;

    IF NEW.is_excluded AND EXISTS (
        SELECT 1
        FROM public.place_assignments pa
        JOIN public.attendees a ON a.id = pa.attendee_id
        JOIN public.user_parties up ON up.id = a.party_id
        WHERE pa.place_id = NEW.place_id AND up.event_id = NEW.event_id
    ) THEN
        RAISE EXCEPTION USING MESSAGE = 'place_exclusion_occupied', ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_place_override() FROM PUBLIC;

CREATE TRIGGER trg_enforce_place_override
BEFORE INSERT OR UPDATE ON public.event_place_overrides
FOR EACH ROW
EXECUTE FUNCTION private.enforce_place_override();

-- An event that changes venue loses its assignments and overrides: they point at the old venue's
-- places. The admin UI says who is affected and asks first (#147).
CREATE FUNCTION private.clear_event_places_on_venue_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.place_assignments pa
    USING public.attendees a, public.user_parties up
    WHERE a.id = pa.attendee_id AND up.id = a.party_id AND up.event_id = NEW.id;

    DELETE FROM public.event_place_overrides WHERE event_id = NEW.id;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.clear_event_places_on_venue_change() FROM PUBLIC;

CREATE TRIGGER trg_clear_event_places_on_venue_change
AFTER UPDATE OF venue_id ON public.events
FOR EACH ROW
WHEN (OLD.venue_id IS DISTINCT FROM NEW.venue_id)
EXECUTE FUNCTION private.clear_event_places_on_venue_change();

-- A location stays in its venue, and a place moves only between locations of the same venue, so
-- an assignment or override can't end up at another venue.
CREATE FUNCTION private.keep_places_in_their_venue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_TABLE_NAME = 'locations' THEN
        IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
            RAISE EXCEPTION USING MESSAGE = 'place_venue_fixed', ERRCODE = 'check_violation';
        END IF;
    ELSIF (SELECT venue_id FROM public.locations WHERE id = NEW.location_id)
          IS DISTINCT FROM (SELECT venue_id FROM public.locations WHERE id = OLD.location_id) THEN
        RAISE EXCEPTION USING MESSAGE = 'place_venue_fixed', ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.keep_places_in_their_venue() FROM PUBLIC;

CREATE TRIGGER trg_keep_location_in_its_venue
BEFORE UPDATE OF venue_id ON public.locations
FOR EACH ROW
EXECUTE FUNCTION private.keep_places_in_their_venue();

CREATE TRIGGER trg_keep_place_in_its_venue
BEFORE UPDATE OF location_id ON public.places
FOR EACH ROW
EXECUTE FUNCTION private.keep_places_in_their_venue();
