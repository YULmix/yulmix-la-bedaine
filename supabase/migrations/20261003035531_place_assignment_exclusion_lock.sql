-- #202: assigning an attendee to a place and excluding that place for the event each checked the
-- other's table without a lock, so under READ COMMITTED both could pass and commit, leaving a
-- place excluded and still held. Both triggers now take the same transaction-scoped advisory
-- lock on the (event, place) pair before their check: whichever commits second sees the first
-- and is refused with its existing code.
--
-- The two-int form pg_advisory_xact_lock(int, int) is a separate key space from the single-bigint
-- form the capacity and waitlist triggers use (hashtext(event_id)), so the keys can't collide
-- with theirs. Each trigger fires per row and a row concerns exactly one place, so there is
-- nothing to sort within a row.
--
-- Bodies are otherwise identical to the definitions in 20260929162040_shared_venues.sql.

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

    -- Serialise with enforce_place_override on this (event, place); each statement below then
    -- reads a fresh snapshot, so a committed exclusion is visible.
    PERFORM pg_advisory_xact_lock(hashtext(v_party.event_id::text), hashtext(NEW.place_id::text));

    IF EXISTS (SELECT 1 FROM public.event_place_overrides o
               WHERE o.event_id = v_party.event_id AND o.place_id = NEW.place_id AND o.is_excluded) THEN
        RAISE EXCEPTION USING MESSAGE = 'place_assignment_place_excluded', ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_place_override()
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

    IF NEW.is_excluded THEN
        -- Same lock as enforce_place_assignment.
        PERFORM pg_advisory_xact_lock(hashtext(NEW.event_id::text), hashtext(NEW.place_id::text));

        IF EXISTS (
            SELECT 1
            FROM public.place_assignments pa
            JOIN public.attendees a ON a.id = pa.attendee_id
            JOIN public.user_parties up ON up.id = a.party_id
            WHERE pa.place_id = NEW.place_id AND up.event_id = NEW.event_id
        ) THEN
            RAISE EXCEPTION USING MESSAGE = 'place_exclusion_occupied', ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
