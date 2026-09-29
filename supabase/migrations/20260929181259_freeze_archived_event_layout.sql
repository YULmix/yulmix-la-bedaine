-- #148 (part of #137): an archived event keeps the venue layout it had.
--
-- Since #145 an event reads its locations and places from a shared venue, so editing the venue
-- would rewrite past editions. Now, when an event is archived, the database copies its venue
-- (locations and places) into a frozen venue that only this event uses (ADR 0020):
--
--   * venues.snapshot_of: the venue a frozen copy was made from. A copy is archived from birth,
--     hidden from the Sites list, and its layout can't change any more (venue_layout_frozen).
--   * The event, its place_assignments and its event_place_overrides move to the copy, in the
--     archiving transaction. Every reader (attendee_places, bed labels, the editor) keeps working
--     and shows the layout as it was.
--   * The live venue's places are no longer held by the archived event's assignments, so they can
--     be renamed, resized or deleted for the editions to come.
--   * An archived event's venue link and overrides can't change either (event_layout_frozen).
--
-- Un-archiving (not offered by the app; possible by SQL) leaves the event on its frozen copy, with
-- its assignments: nothing is lost. Picking a live venue again then clears its places as any
-- venue change does. Archiving it again doesn't copy the copy.
--
-- Existing data: archived events already on a venue are frozen now, the same way.
--
-- Errors are stable English codes; src/lib/dbErrors.js maps them to French (#102).

ALTER TABLE public.venues ADD COLUMN snapshot_of uuid REFERENCES public.venues (id);

CREATE INDEX venues_snapshot_of_idx ON public.venues (snapshot_of);

COMMENT ON COLUMN public.venues.snapshot_of IS
    'Set on the frozen copy of a venue made when an event using it was archived (#148): the venue it copies. The copy''s layout never changes.';

-- ---------------------------------------------------------------------------------------------
-- Freezing. Runs as the table owner: the archiving admin's rights aren't the question, the copy
-- has to be complete. bedaine.freezing_event lets the copy through the guards below, for this
-- transaction only (PostgREST gives clients no way to set it).

CREATE FUNCTION private.freeze_event_layout(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_source public.venues%ROWTYPE;
    v_copy uuid;
    v_location record;
    v_new_location uuid;
    v_place record;
    v_new_place uuid;
BEGIN
    SELECT v.* INTO v_source
    FROM public.events e JOIN public.venues v ON v.id = e.venue_id
    WHERE e.id = p_event_id;

    -- No venue, or already on a frozen copy (archived again after being un-archived).
    IF NOT FOUND OR v_source.snapshot_of IS NOT NULL THEN
        RETURN;
    END IF;

    PERFORM set_config('bedaine.freezing_event', p_event_id::text, true);

    INSERT INTO public.venues (name, address, archived_at, snapshot_of)
    VALUES (v_source.name, v_source.address, now(), v_source.id)
    RETURNING id INTO v_copy;

    -- The event moves first, so its assignments and overrides can follow place by place (their
    -- triggers check the place is at the event's venue). The venue-change trigger leaves them be.
    UPDATE public.events SET venue_id = v_copy WHERE id = p_event_id;

    FOR v_location IN SELECT * FROM public.locations WHERE venue_id = v_source.id LOOP
        INSERT INTO public.locations (venue_id, name, note, sort_order, created_at)
        VALUES (v_copy, v_location.name, v_location.note, v_location.sort_order, v_location.created_at)
        RETURNING id INTO v_new_location;

        FOR v_place IN SELECT * FROM public.places WHERE location_id = v_location.id LOOP
            INSERT INTO public.places (location_id, label, type, capacity, sort_order, created_at)
            VALUES (v_new_location, v_place.label, v_place.type, v_place.capacity, v_place.sort_order, v_place.created_at)
            RETURNING id INTO v_new_place;

            UPDATE public.place_assignments pa
            SET place_id = v_new_place
            FROM public.attendees a, public.user_parties up
            WHERE pa.place_id = v_place.id
              AND a.id = pa.attendee_id AND up.id = a.party_id AND up.event_id = p_event_id;

            UPDATE public.event_place_overrides
            SET place_id = v_new_place
            WHERE event_id = p_event_id AND place_id = v_place.id;
        END LOOP;
    END LOOP;

    PERFORM set_config('bedaine.freezing_event', '', true);
END;
$$;

REVOKE ALL ON FUNCTION private.freeze_event_layout(uuid) FROM PUBLIC;

CREATE FUNCTION private.freeze_layout_on_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.freeze_event_layout(NEW.id);
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.freeze_layout_on_archive() FROM PUBLIC;

CREATE TRIGGER trg_freeze_layout_on_archive
AFTER UPDATE OF status ON public.events
FOR EACH ROW
WHEN (NEW.status = 'ARCHIVED' AND OLD.status IS DISTINCT FROM 'ARCHIVED' AND NEW.venue_id IS NOT NULL)
EXECUTE FUNCTION private.freeze_layout_on_archive();

-- The venue change the freeze makes keeps the event's places: they move with it.
CREATE OR REPLACE FUNCTION private.clear_event_places_on_venue_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF current_setting('bedaine.freezing_event', true) = NEW.id::text THEN
        RETURN NULL;
    END IF;

    DELETE FROM public.place_assignments pa
    USING public.attendees a, public.user_parties up
    WHERE a.id = pa.attendee_id AND up.id = a.party_id AND up.event_id = NEW.id;

    DELETE FROM public.event_place_overrides WHERE event_id = NEW.id;
    RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Guards: a frozen layout stays as it was.

CREATE FUNCTION private.guard_frozen_layout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row record := COALESCE(NEW, OLD);
    v_frozen boolean;
BEGIN
    IF COALESCE(current_setting('bedaine.freezing_event', true), '') <> '' THEN
        RETURN v_row;
    END IF;

    IF TG_TABLE_NAME = 'venues' THEN
        v_frozen := (TG_OP = 'INSERT' AND NEW.snapshot_of IS NOT NULL)
            OR (TG_OP = 'UPDATE' AND (OLD.snapshot_of IS NOT NULL OR NEW.snapshot_of IS NOT NULL)
                AND (NEW.name, NEW.address, NEW.snapshot_of) IS DISTINCT FROM (OLD.name, OLD.address, OLD.snapshot_of));
    ELSIF TG_TABLE_NAME = 'locations' THEN
        SELECT v.snapshot_of IS NOT NULL INTO v_frozen FROM public.venues v WHERE v.id = v_row.venue_id;
    ELSIF TG_TABLE_NAME = 'places' THEN
        SELECT v.snapshot_of IS NOT NULL INTO v_frozen
        FROM public.locations l JOIN public.venues v ON v.id = l.venue_id
        WHERE l.id = v_row.location_id;
        -- Moving a place into a frozen location is as frozen as moving one out.
        IF TG_OP = 'UPDATE' AND NOT COALESCE(v_frozen, false) THEN
            SELECT v.snapshot_of IS NOT NULL INTO v_frozen
            FROM public.locations l JOIN public.venues v ON v.id = l.venue_id
            WHERE l.id = OLD.location_id;
        END IF;
    ELSE -- event_place_overrides
        SELECT e.status = 'ARCHIVED' INTO v_frozen FROM public.events e WHERE e.id = v_row.event_id;
        IF v_frozen THEN
            RAISE EXCEPTION USING MESSAGE = 'event_layout_frozen', ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF COALESCE(v_frozen, false) THEN
        RAISE EXCEPTION USING MESSAGE = 'venue_layout_frozen', ERRCODE = 'check_violation';
    END IF;
    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_frozen_layout() FROM PUBLIC;

CREATE TRIGGER trg_guard_frozen_venue
BEFORE INSERT OR UPDATE ON public.venues
FOR EACH ROW EXECUTE FUNCTION private.guard_frozen_layout();

CREATE TRIGGER trg_guard_frozen_locations
BEFORE INSERT OR UPDATE OR DELETE ON public.locations
FOR EACH ROW EXECUTE FUNCTION private.guard_frozen_layout();

CREATE TRIGGER trg_guard_frozen_places
BEFORE INSERT OR UPDATE OR DELETE ON public.places
FOR EACH ROW EXECUTE FUNCTION private.guard_frozen_layout();

CREATE TRIGGER trg_guard_frozen_overrides
BEFORE INSERT OR UPDATE OR DELETE ON public.event_place_overrides
FOR EACH ROW EXECUTE FUNCTION private.guard_frozen_layout();

-- An archived event stays on its venue (changing it would clear who slept where). Changing the
-- venue while un-archiving is allowed.
CREATE FUNCTION private.keep_archived_event_venue()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF OLD.status = 'ARCHIVED' AND NEW.status = 'ARCHIVED'
       AND COALESCE(current_setting('bedaine.freezing_event', true), '') <> NEW.id::text THEN
        RAISE EXCEPTION USING MESSAGE = 'event_layout_frozen', ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.keep_archived_event_venue() FROM PUBLIC;

CREATE TRIGGER trg_keep_archived_event_venue
BEFORE UPDATE OF venue_id ON public.events
FOR EACH ROW
WHEN (OLD.venue_id IS DISTINCT FROM NEW.venue_id)
EXECUTE FUNCTION private.keep_archived_event_venue();

-- ---------------------------------------------------------------------------------------------
-- Existing data: archived events already on a (live) venue are frozen now.

DO $$
DECLARE
    v_event uuid;
BEGIN
    FOR v_event IN
        SELECT e.id FROM public.events e JOIN public.venues v ON v.id = e.venue_id
        WHERE e.status = 'ARCHIVED' AND v.snapshot_of IS NULL
        ORDER BY e.created_at
    LOOP
        PERFORM private.freeze_event_layout(v_event);
    END LOOP;
END;
$$;
