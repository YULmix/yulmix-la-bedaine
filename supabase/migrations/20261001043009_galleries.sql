-- #177: galleries. A gallery is an ordered collection of images (at most 30, the first is the
-- cover, no captions). It replaces the single photo per location (#124):
--
--   * A location has one gallery: what the room looks like, seen by who sleeps there.
--   * A venue has one gallery per kind, a fixed English name never shown to people:
--       - general: what the venue looks like, on the info page, for anyone who can read an event
--         held there;
--       - assignments: for admins doing the place assignment, admins only.
--     A third kind is a CHECK away.
--   * A gallery row is created with its first image (add_gallery_image); an owner without one
--     has an empty gallery.
--   * Images stay in the public location-photos bucket (#124), which only admins can write; it now
--     holds every gallery's images. New object names are "<location or venue id>/<random uuid>.jpg", the
--     photos #124 stored keep theirs. Nothing in a gallery is secret.
--   * Archiving an event freezes its venue (ADR 0020): the frozen copy gets copies of the venue's
--     and its locations' galleries, whose images point at the same objects, and they can't change
--     any more (venue_layout_frozen).
--   * Cleanup is #124's, generalised: Postgres can't delete a Storage object, so after removing an
--     image or deleting a location, the app asks unused_gallery_images() which objects no image
--     points at and removes them through the Storage API.
--
-- Existing data: each locations.photo_path becomes image 1 of its location's gallery, then the
-- column goes, and attendee_places loses location_photo_path.
--
-- Errors are stable English codes; src/lib/dbErrors.js maps them to French (#102).

CREATE TABLE public.galleries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id uuid REFERENCES public.venues (id) ON DELETE CASCADE,
    location_id uuid UNIQUE REFERENCES public.locations (id) ON DELETE CASCADE,
    kind text,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Exactly one owner: a venue with a kind, or a location (which has no kind).
    CONSTRAINT galleries_one_owner CHECK (
        (venue_id IS NOT NULL AND location_id IS NULL AND kind IN ('general', 'assignments'))
        OR (venue_id IS NULL AND location_id IS NOT NULL AND kind IS NULL)
    ),
    CONSTRAINT galleries_venue_kind_key UNIQUE (venue_id, kind)
);

COMMENT ON TABLE public.galleries IS
    'An ordered collection of images (#177), owned by a location or by a venue (one per kind: general, assignments).';
COMMENT ON COLUMN public.galleries.kind IS
    'A venue gallery''s kind (#177): general (shown on the info page) or assignments (admins only). NULL for a location''s gallery. Never shown to people.';

CREATE TABLE public.gallery_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    gallery_id uuid NOT NULL REFERENCES public.galleries (id) ON DELETE CASCADE,
    path text NOT NULL CHECK (btrim(path) <> ''),
    position integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Deferred, so two images can swap places in one statement.
    CONSTRAINT gallery_images_position_key UNIQUE (gallery_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX gallery_images_path_idx ON public.gallery_images (path);

COMMENT ON TABLE public.gallery_images IS
    'A gallery''s images (#177), in position order; the first is the cover. path is an object in the public location-photos bucket, possibly shared with a frozen copy''s image.';

-- ---------------------------------------------------------------------------------------------
-- At most 30 images. The gallery row is locked first, so two uploads can't both take the 30th.

CREATE FUNCTION private.limit_gallery_images()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM 1 FROM public.galleries WHERE id = NEW.gallery_id FOR UPDATE;
    IF (SELECT count(*) FROM public.gallery_images WHERE gallery_id = NEW.gallery_id AND id <> NEW.id) >= 30 THEN
        RAISE EXCEPTION USING MESSAGE = 'gallery_full', ERRCODE = 'check_violation',
            DETAIL = json_build_object('max', 30)::text;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.limit_gallery_images() FROM PUBLIC;

CREATE TRIGGER trg_limit_gallery_images
BEFORE INSERT OR UPDATE OF gallery_id ON public.gallery_images
FOR EACH ROW EXECUTE FUNCTION private.limit_gallery_images();

-- ---------------------------------------------------------------------------------------------
-- Access. Admins write; readers follow the owner:
--   * a venue's general gallery: whoever can read the venue (anyone who can read an event held
--     there), signed in;
--   * a location's gallery: whoever can read the location (members, where their attendees sleep);
--   * a venue's assignments gallery: admins only.
-- Each subquery runs under the next table's RLS.

ALTER TABLE public.galleries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Galleries: Admin full access" ON public.galleries
    FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Galleries: Read with their venue or location" ON public.galleries
    FOR SELECT TO authenticated
    USING (
        (kind = 'general' AND EXISTS (SELECT 1 FROM public.venues v WHERE v.id = galleries.venue_id))
        OR (location_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.locations l WHERE l.id = galleries.location_id))
    );

CREATE POLICY "Gallery Images: Admin full access" ON public.gallery_images
    FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Gallery Images: Read with their gallery" ON public.gallery_images
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.galleries g WHERE g.id = gallery_images.gallery_id));

REVOKE ALL ON TABLE public.galleries, public.gallery_images FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.galleries, public.gallery_images TO authenticated;
GRANT SELECT ON TABLE public.galleries, public.gallery_images TO service_role;

-- ---------------------------------------------------------------------------------------------
-- Adding an image: to the location's gallery, or to the venue's gallery of that kind, created
-- with its first image. It goes last. Runs as the caller, so RLS has the last word.

CREATE FUNCTION public.add_gallery_image(
    p_path text,
    p_location_id uuid DEFAULT NULL,
    p_venue_id uuid DEFAULT NULL,
    p_kind text DEFAULT NULL
)
RETURNS public.gallery_images
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_gallery uuid;
    v_image public.gallery_images;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;

    INSERT INTO public.galleries (location_id, venue_id, kind)
    VALUES (p_location_id, p_venue_id, p_kind)
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_gallery FROM public.galleries
    WHERE (p_location_id IS NOT NULL AND location_id = p_location_id)
       OR (p_location_id IS NULL AND venue_id = p_venue_id AND kind = p_kind)
    FOR UPDATE;

    INSERT INTO public.gallery_images (gallery_id, path, position)
    VALUES (v_gallery, p_path,
            COALESCE((SELECT max(position) + 1 FROM public.gallery_images WHERE gallery_id = v_gallery), 0))
    RETURNING * INTO v_image;
    RETURN v_image;
END;
$$;

REVOKE ALL ON FUNCTION public.add_gallery_image(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_gallery_image(text, uuid, uuid, text) TO authenticated;

-- Moving an image one step towards the cover (p_offset = -1) or away from it (1): it swaps
-- positions with its neighbour. Moving the first up or the last down changes nothing.
CREATE FUNCTION public.move_gallery_image(p_image_id uuid, p_offset integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_image public.gallery_images;
    v_neighbour public.gallery_images;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;

    SELECT * INTO v_image FROM public.gallery_images WHERE id = p_image_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    PERFORM 1 FROM public.galleries WHERE id = v_image.gallery_id FOR UPDATE;

    SELECT * INTO v_neighbour FROM public.gallery_images
    WHERE gallery_id = v_image.gallery_id
      AND CASE WHEN p_offset < 0 THEN position < v_image.position ELSE position > v_image.position END
    ORDER BY CASE WHEN p_offset < 0 THEN -position ELSE position END
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE public.gallery_images
    SET position = CASE WHEN id = v_image.id THEN v_neighbour.position ELSE v_image.position END
    WHERE id IN (v_image.id, v_neighbour.id);
END;
$$;

REVOKE ALL ON FUNCTION public.move_gallery_image(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_gallery_image(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Cleanup: which objects of the bucket no gallery image points at, frozen copies' included: those
-- named in p_paths (an image just removed, the images of a location just deleted, an upload whose
-- save failed), and any older than an hour (left behind by a removal that failed). The caller
-- removes them through the Storage API. Replaces unused_location_photos().

DROP FUNCTION public.unused_location_photos(text[]);

CREATE FUNCTION public.unused_gallery_images(p_paths text[] DEFAULT '{}')
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT o.name
    FROM storage.objects o
    WHERE o.bucket_id = 'location-photos'
      AND (o.name = ANY (p_paths) OR o.created_at < now() - interval '1 hour')
      AND NOT EXISTS (SELECT 1 FROM public.gallery_images gi WHERE gi.path = o.name);
END;
$$;

REVOKE ALL ON FUNCTION public.unused_gallery_images(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unused_gallery_images(text[]) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Freezing copies the galleries (same as 20260930202924, without photo_path, plus galleries).

CREATE FUNCTION private.copy_gallery(p_from uuid, p_location_id uuid, p_venue_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_source public.galleries%ROWTYPE;
    v_copy uuid;
BEGIN
    SELECT * INTO v_source FROM public.galleries WHERE id = p_from;
    INSERT INTO public.galleries (location_id, venue_id, kind, created_at)
    VALUES (p_location_id, p_venue_id, v_source.kind, v_source.created_at)
    RETURNING id INTO v_copy;

    INSERT INTO public.gallery_images (gallery_id, path, position, created_at)
    SELECT v_copy, path, position, created_at FROM public.gallery_images WHERE gallery_id = p_from;
END;
$$;

REVOKE ALL ON FUNCTION private.copy_gallery(uuid, uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.freeze_event_layout(p_event_id uuid)
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
    v_gallery record;
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

    FOR v_gallery IN SELECT id FROM public.galleries WHERE venue_id = v_source.id LOOP
        PERFORM private.copy_gallery(v_gallery.id, NULL, v_copy);
    END LOOP;

    -- The event moves first, so its assignments and overrides can follow place by place (their
    -- triggers check the place is at the event's venue). The venue-change trigger leaves them be.
    UPDATE public.events SET venue_id = v_copy WHERE id = p_event_id;

    FOR v_location IN SELECT * FROM public.locations WHERE venue_id = v_source.id LOOP
        INSERT INTO public.locations (venue_id, name, note, sort_order, created_at)
        VALUES (v_copy, v_location.name, v_location.note, v_location.sort_order, v_location.created_at)
        RETURNING id INTO v_new_location;

        FOR v_gallery IN SELECT id FROM public.galleries WHERE location_id = v_location.id LOOP
            PERFORM private.copy_gallery(v_gallery.id, v_new_location, NULL);
        END LOOP;

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

-- ---------------------------------------------------------------------------------------------
-- A frozen venue's galleries stay as they were (same as 20260929181259, plus the two tables).

CREATE OR REPLACE FUNCTION private.guard_frozen_layout()
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
    ELSIF TG_TABLE_NAME = 'galleries' THEN
        v_frozen := private.gallery_owner_frozen(v_row.venue_id, v_row.location_id)
            OR (TG_OP = 'UPDATE' AND private.gallery_owner_frozen(OLD.venue_id, OLD.location_id));
    ELSIF TG_TABLE_NAME = 'gallery_images' THEN
        SELECT private.gallery_owner_frozen(g.venue_id, g.location_id) INTO v_frozen
        FROM public.galleries g WHERE g.id = v_row.gallery_id;
        IF TG_OP = 'UPDATE' AND NOT COALESCE(v_frozen, false) THEN
            SELECT private.gallery_owner_frozen(g.venue_id, g.location_id) INTO v_frozen
            FROM public.galleries g WHERE g.id = OLD.gallery_id;
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

-- Whether a gallery's owner (a venue, or a location's venue) is a frozen copy.
CREATE FUNCTION private.gallery_owner_frozen(p_venue_id uuid, p_location_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT v.snapshot_of IS NOT NULL
        FROM public.venues v
        WHERE v.id = COALESCE(p_venue_id, (SELECT l.venue_id FROM public.locations l WHERE l.id = p_location_id))
    ), false);
$$;

REVOKE ALL ON FUNCTION private.gallery_owner_frozen(uuid, uuid) FROM PUBLIC;

CREATE TRIGGER trg_guard_frozen_galleries
BEFORE INSERT OR UPDATE OR DELETE ON public.galleries
FOR EACH ROW EXECUTE FUNCTION private.guard_frozen_layout();

CREATE TRIGGER trg_guard_frozen_gallery_images
BEFORE INSERT OR UPDATE OR DELETE ON public.gallery_images
FOR EACH ROW EXECUTE FUNCTION private.guard_frozen_layout();

-- ---------------------------------------------------------------------------------------------
-- Existing data: each location's photo becomes image 1 of its gallery, frozen copies' included
-- (the guard lets this transaction through, as it does a freeze).

SELECT set_config('bedaine.freezing_event', 'galleries-migration', true);

WITH photo_galleries AS (
    INSERT INTO public.galleries (location_id)
    SELECT id FROM public.locations WHERE photo_path IS NOT NULL
    RETURNING id, location_id
)
INSERT INTO public.gallery_images (gallery_id, path, position)
SELECT g.id, l.photo_path, 0
FROM photo_galleries g JOIN public.locations l ON l.id = g.location_id;

SELECT set_config('bedaine.freezing_event', '', true);

-- The view loses location_photo_path (same as 20260929162040): a column can't be dropped in place.
DROP VIEW public.attendee_places;

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

-- Its photos are now location galleries' first images (above), and the new app no longer reads it.
-- The app still live during the deploy reads it in the Sites editor and the member's Couchage
-- row, which fail until the new build is out: minutes, accepted (#177 asks for the column to go).
-- squawk-ignore ban-drop-column
ALTER TABLE public.locations DROP COLUMN photo_path;
