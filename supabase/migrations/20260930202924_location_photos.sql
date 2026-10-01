-- #124 (part of #137): a photo of each location ("what does this room look like").
--
-- Decided with the organisers on #124: one photo per location (the places in a room share it),
-- set by admins only, and seen by participants too: it isn't private.
--
--   * location-photos: a PUBLIC bucket, read by plain URL like the feedback bucket. Only admins
--     may upload, replace or delete an object (storage.objects policies below). Object names are
--     "<location id>/<random uuid>.<ext>", so a URL can't be guessed from a location.
--   * locations.photo_path: the object's name in the bucket, or NULL. Members read it where they
--     already read the location (where their attendees sleep), and through attendee_places.
--   * An archived event's frozen copy (#148) keeps the photo the location had: the copy points at
--     the same object. Replacing the live location's photo leaves that object to the copy.
--
-- Postgres can't delete a Storage object (storage.protect_delete refuses it; the file lives
-- outside the database), so deleting a location or replacing its photo can't cascade to Storage.
-- Instead the app, after such a change, asks unused_location_photos() which objects no location
-- points at any more and removes them through the Storage API. An object only just uploaded is
-- left alone unless named, so a sweep can't take a photo whose location isn't saved yet; one left
-- behind by a failed removal is taken by the next sweep.
--
-- Errors are stable English codes; src/lib/dbErrors.js maps them to French (#102).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('location-photos', 'location-photos', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Uploading with upsert, replacing and removing also need SELECT. Public reads go by URL and need
-- no policy.
CREATE POLICY "Location photos: Admin full access" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'location-photos' AND public.is_admin())
    WITH CHECK (bucket_id = 'location-photos' AND public.is_admin());

ALTER TABLE public.locations ADD COLUMN photo_path text CHECK (btrim(photo_path) <> '');

COMMENT ON COLUMN public.locations.photo_path IS
    'The location''s photo (#124): an object name in the public location-photos bucket, or NULL. A frozen copy shares its source''s object.';

-- ---------------------------------------------------------------------------------------------
-- The frozen copy keeps the photo (same as 20260929181259, plus photo_path).

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
        INSERT INTO public.locations (venue_id, name, note, photo_path, sort_order, created_at)
        VALUES (v_copy, v_location.name, v_location.note, v_location.photo_path, v_location.sort_order, v_location.created_at)
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

-- Archived events frozen before this migration have no photo to keep: none existed.

-- ---------------------------------------------------------------------------------------------
-- The member sees the photo of the location they sleep in, next to its label. New column last,
-- so the view can be replaced in place.

CREATE OR REPLACE VIEW public.attendee_places WITH (security_invoker = true) AS
SELECT pa.attendee_id,
       a.party_id,
       a.name AS attendee_name,
       up.event_id,
       l.id AS location_id,
       l.name AS location_name,
       pl.id AS place_id,
       pl.label AS place_label,
       pl.type AS place_type,
       l.name || ' · ' || pl.label AS bed_label,
       l.photo_path AS location_photo_path
FROM public.place_assignments pa
JOIN public.attendees a ON a.id = pa.attendee_id
JOIN public.user_parties up ON up.id = a.party_id
JOIN public.places pl ON pl.id = pa.place_id
JOIN public.locations l ON l.id = pl.location_id;

-- ---------------------------------------------------------------------------------------------
-- Which objects of the bucket no location points at: those named in p_paths (the photo the admin
-- just replaced, or the one of the location just deleted), and any older than an hour (left
-- behind by a removal that failed). The caller removes them through the Storage API.

CREATE FUNCTION public.unused_location_photos(p_paths text[] DEFAULT '{}')
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
      AND NOT EXISTS (SELECT 1 FROM public.locations l WHERE l.photo_path = o.name);
END;
$$;

REVOKE ALL ON FUNCTION public.unused_location_photos(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unused_location_photos(text[]) TO authenticated;
