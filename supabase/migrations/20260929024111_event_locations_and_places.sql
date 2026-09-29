-- #113 (part 1 of #112): per-event sleeping locations and places, and who holds which place.
--
-- Organisers typed sleeping spots as free text into attendees.assigned_bed, so nothing knew which
-- spots existed. Now an event has locations (a room, the yard…), each with places (a bed, a
-- sofa…, with a type and a capacity), and an attendee holds one place for the whole event.
--
--   * event_locations / event_places: what exists. Admins write them.
--   * place_assignments: who sleeps where, one row per attendee (attendees(id), ADR 0018). No
--     capacity constraint: overbooking is allowed on purpose, the UI warns.
--   * attendee_places: the view every reader uses (attendee → place → location, and the
--     "<location> · <place>" label). No copy of the label is stored anywhere.
--
-- Additive on purpose: attendees.assigned_bed and its readers (member summary, Logistique,
-- accommodation email) are unchanged here. #114 switches them to the view, adds the assignment
-- dropdown, and drops the free-text column; there are no free-text beds after that.
--
-- Errors are stable English codes; src/lib/dbErrors.js maps them to French (#102).

-- ---------------------------------------------------------------------------------------------
-- Tables.

CREATE TABLE public.event_locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    name text NOT NULL CHECK (btrim(name) <> ''),
    note text,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_locations_event_id_idx ON public.event_locations (event_id);

COMMENT ON TABLE public.event_locations IS
    'Where people sleep at an event (#112): a room, the yard, a campground… Holds places.';

CREATE TABLE public.event_places (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id uuid NOT NULL REFERENCES public.event_locations (id) ON DELETE CASCADE,
    label text NOT NULL CHECK (btrim(label) <> ''),
    -- The sleeping-preference vocabulary (ACCOMMODATION_OPTIONS), so preferences and places match.
    type text NOT NULL CHECK (type IN ('bed', 'sofa', 'floor', 'camping', 'outside_other')),
    capacity integer NOT NULL DEFAULT 1 CHECK (capacity >= 1),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_places_location_id_idx ON public.event_places (location_id);

COMMENT ON TABLE public.event_places IS
    'A spot inside a location (#112): a bed, a sofa, floor space… capacity is how many people it is meant for; exceeding it is allowed, the UI warns.';

CREATE TABLE public.place_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NO ACTION, checked at the end of the statement: deleting an occupied place, or the location
    -- holding it, is refused, while deleting a whole event (which also deletes its parties, their
    -- attendees and so their assignments) still works.
    place_id uuid NOT NULL REFERENCES public.event_places (id),
    -- One place per attendee for the whole event. Removing the attendee frees it.
    attendee_id uuid NOT NULL UNIQUE REFERENCES public.attendees (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX place_assignments_place_id_idx ON public.place_assignments (place_id);

COMMENT ON TABLE public.place_assignments IS
    'Which place an attendee holds for the whole event (#112). Read through attendee_places.';

-- ---------------------------------------------------------------------------------------------
-- Access. Admins read and write everything. A member reads only what concerns their own
-- attendees: their assignments, and the places and locations those point at. Each policy's
-- subquery runs under the next table's RLS (place → assignment → attendee → party).

ALTER TABLE public.event_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event Locations: Admin full access" ON public.event_locations
    FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Event Locations: Member reads where they sleep" ON public.event_locations
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.event_places pl WHERE pl.location_id = event_locations.id));

CREATE POLICY "Event Places: Admin full access" ON public.event_places
    FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Event Places: Member reads where they sleep" ON public.event_places
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.place_assignments pa WHERE pa.place_id = event_places.id));

CREATE POLICY "Place Assignments: Admin full access" ON public.place_assignments
    FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Place Assignments: Member reads their own" ON public.place_assignments
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.attendees a WHERE a.id = place_assignments.attendee_id));

REVOKE ALL ON TABLE public.event_locations, public.event_places, public.place_assignments
    FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.event_locations, public.event_places, public.place_assignments
    TO authenticated;
-- The send-party-email Edge Function will read beds with the service role (#114).
GRANT SELECT ON TABLE public.event_locations, public.event_places, public.place_assignments
    TO service_role;

-- ---------------------------------------------------------------------------------------------
-- The view. security_invoker, so it shows exactly what the tables' RLS lets the reader see.

CREATE VIEW public.attendee_places WITH (security_invoker = true) AS
SELECT pa.attendee_id,
       a.party_id,
       a.name AS attendee_name,
       l.event_id,
       l.id AS location_id,
       l.name AS location_name,
       pl.id AS place_id,
       pl.label AS place_label,
       pl.type AS place_type,
       l.name || ' · ' || pl.label AS bed_label
FROM public.place_assignments pa
JOIN public.attendees a ON a.id = pa.attendee_id
JOIN public.event_places pl ON pl.id = pa.place_id
JOIN public.event_locations l ON l.id = pl.location_id;

COMMENT ON VIEW public.attendee_places IS
    'Where each assigned attendee sleeps, with the "<location> · <place>" label shown to people (#112).';

REVOKE ALL ON TABLE public.attendee_places FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.attendee_places TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Rules.

-- Only an attendee of an active party, to a place of the party's own event.
CREATE FUNCTION private.enforce_place_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_party public.user_parties%ROWTYPE;
    v_place_event uuid;
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

    SELECT l.event_id INTO v_place_event
    FROM public.event_places pl
    JOIN public.event_locations l ON l.id = pl.location_id
    WHERE pl.id = NEW.place_id;

    IF FOUND AND v_place_event <> v_party.event_id THEN
        RAISE EXCEPTION USING MESSAGE = 'place_assignment_wrong_event', ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_place_assignment() FROM PUBLIC;

CREATE TRIGGER trg_enforce_place_assignment
BEFORE INSERT OR UPDATE ON public.place_assignments
FOR EACH ROW
EXECUTE FUNCTION private.enforce_place_assignment();

-- A cancelled or waitlisted party frees its places. (No column list: is_waitlisted is set by a
-- BEFORE trigger, which an UPDATE OF column list wouldn't see.)
CREATE FUNCTION private.release_inactive_party_places()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.place_assignments pa
    USING public.attendees a
    WHERE a.id = pa.attendee_id AND a.party_id = NEW.id;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.release_inactive_party_places() FROM PUBLIC;

CREATE TRIGGER trg_release_inactive_party_places
AFTER UPDATE ON public.user_parties
FOR EACH ROW
WHEN (
    (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
    OR (NEW.is_waitlisted AND NOT OLD.is_waitlisted)
)
EXECUTE FUNCTION private.release_inactive_party_places();

-- A place or location stays in its event, so an assignment can't end up in another event.
CREATE FUNCTION private.keep_places_in_their_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_TABLE_NAME = 'event_locations' THEN
        IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
            RAISE EXCEPTION USING MESSAGE = 'place_event_fixed', ERRCODE = 'check_violation';
        END IF;
    ELSIF (SELECT event_id FROM public.event_locations WHERE id = NEW.location_id)
          IS DISTINCT FROM (SELECT event_id FROM public.event_locations WHERE id = OLD.location_id) THEN
        RAISE EXCEPTION USING MESSAGE = 'place_event_fixed', ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.keep_places_in_their_event() FROM PUBLIC;

CREATE TRIGGER trg_keep_location_in_its_event
BEFORE UPDATE OF event_id ON public.event_locations
FOR EACH ROW
EXECUTE FUNCTION private.keep_places_in_their_event();

CREATE TRIGGER trg_keep_place_in_its_event
BEFORE UPDATE OF location_id ON public.event_places
FOR EACH ROW
EXECUTE FUNCTION private.keep_places_in_their_event();
