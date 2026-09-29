-- #113 (part 1 of #112): per-event sleeping locations and places, and stable attendee ids.
--
-- Organisers typed sleeping spots as free text into attendees[].assigned_bed, so nothing knew
-- which spots existed. Now an event has locations (a room, the yard…), each with places (a bed,
-- a sofa…, with a type and a capacity), and an attendee is assigned a place for the whole event.
--
--   * event_locations / event_places: what exists. Admin-only.
--   * place_assignments: who sleeps where, one row per attendee, keyed by the attendee's new
--     stable id. No capacity constraint: overbooking is allowed on purpose, the UI warns.
--   * attendees[].id: a uuid the database gives each attendee. A client can send an attendee's
--     id back to keep it, but can't invent one, reuse another attendee's, or duplicate one.
--   * attendees[].assigned_bed stays, as a mirror of the assignment ("<location> · <place>")
--     kept by triggers, so the member summary, the accommodation email and #94 work unchanged.
--     On an event with locations it is never free text: whatever a client sends is replaced.
--
-- Order of the BEFORE triggers on user_parties (Postgres fires them by name):
--   trg_assign_attendee_ids (a…)             ids first, so the next ones can match by id
--   … existing triggers …
--   trg_protect_admin_only_party_fields (p…) a member's beds come back from the stored row, by id
--   trg_sync_assigned_bed_from_places (s…)   on an event with locations, beds = the assignments
--
-- Errors are stable English codes; src/lib/dbErrors.js maps them to French (#102).

-- 1. Tables ------------------------------------------------------------------------------------

CREATE TABLE public.event_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    note TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX event_locations_event_id_idx ON public.event_locations (event_id);

COMMENT ON TABLE public.event_locations IS
  'Where people sleep at an event (#112): a room, the yard, a campground… Holds places. Admin-only.';

CREATE TABLE public.event_places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL REFERENCES public.event_locations (id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (btrim(label) <> ''),
    -- The sleeping-preference vocabulary (ACCOMMODATION_OPTIONS), so preferences and places match.
    type TEXT NOT NULL CHECK (type IN ('bed', 'sofa', 'floor', 'camping', 'outside_other')),
    capacity INT NOT NULL DEFAULT 1 CHECK (capacity >= 1),
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX event_places_location_id_idx ON public.event_places (location_id);

COMMENT ON TABLE public.event_places IS
  'A spot inside a location (#112): a bed, a sofa, floor space… capacity is how many people it is meant for; exceeding it is allowed, the UI warns.';

CREATE TABLE public.place_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NO ACTION, checked at the end of the statement: deleting an occupied place, or the location
    -- holding it, is refused, while deleting a whole event (which also deletes its parties, and
    -- with them their assignments) still works.
    place_id UUID NOT NULL REFERENCES public.event_places (id),
    party_id UUID NOT NULL REFERENCES public.user_parties (id) ON DELETE CASCADE,
    -- An attendees[].id of that party.
    attendee_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT place_assignments_party_attendee_key UNIQUE (party_id, attendee_id)
);

CREATE INDEX place_assignments_place_id_idx ON public.place_assignments (place_id);

COMMENT ON TABLE public.place_assignments IS
  'Which place an attendee holds for the whole event (#112). attendees[].assigned_bed mirrors it.';

ALTER TABLE public.event_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_assignments ENABLE ROW LEVEL SECURITY;

-- Members don't read these: they see the mirrored label on their own party.
CREATE POLICY "Event Locations: Admin full access" ON public.event_locations
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Event Places: Admin full access" ON public.event_places
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Place Assignments: Admin full access" ON public.place_assignments
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- No grant to anon at all; authenticated goes through the admin-only policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.event_locations, public.event_places, public.place_assignments
TO authenticated;

-- 2. Stable attendee ids -----------------------------------------------------------------------

-- On UPDATE, an attendee keeps the id it is sent with when that id is one of this party's stored
-- attendees (first occurrence only). Otherwise it gets back a stored id by name, the way #94 matched beds,
-- so an older client that doesn't send ids keeps them too; failing that, a new uuid. So an id
-- can't be forged, taken from another party, or given to two attendees.
CREATE FUNCTION public.assign_attendee_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_old jsonb := '[]'::jsonb;
    v_old_ids text[];
    v_kept text[] := '{}';
    v_used text[] := '{}';
    v_attendee jsonb;
    v_attendees jsonb := '[]'::jsonb;
    v_id text;
    v_ord bigint;
BEGIN
    IF jsonb_typeof(NEW.attendees) IS DISTINCT FROM 'array' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND jsonb_typeof(OLD.attendees) = 'array' THEN
        v_old := OLD.attendees;
    END IF;

    SELECT COALESCE(array_agg(o.value->>'id'), '{}') INTO v_old_ids
    FROM jsonb_array_elements(v_old) AS o(value)
    WHERE jsonb_typeof(o.value) = 'object' AND o.value->>'id' IS NOT NULL;

    -- First pass: the ids sent that are legitimately this party's. On INSERT there is no stored
    -- attendee to take an id from, so any well-formed uuid is kept: the member form's upsert runs
    -- the INSERT branch first, and its ids must reach the UPDATE branch intact. Assignments are
    -- keyed by (party, attendee), so an id copied from another party gets nothing of theirs.
    FOR v_attendee IN SELECT value FROM jsonb_array_elements(NEW.attendees) LOOP
        v_id := CASE WHEN jsonb_typeof(v_attendee) = 'object' THEN lower(v_attendee->>'id') END;
        IF v_id IS NOT NULL
           AND (v_id = ANY (v_old_ids)
                OR (TG_OP = 'INSERT' AND v_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
           AND NOT (v_id = ANY (v_used)) THEN
            v_used := v_used || v_id;
            v_kept := array_append(v_kept, v_id);
        ELSE
            v_kept := array_append(v_kept, NULL);
        END IF;
    END LOOP;

    -- Second pass: everyone else gets a stored id by name, or a new one.
    FOR v_attendee, v_ord IN SELECT value, ordinality FROM jsonb_array_elements(NEW.attendees) WITH ORDINALITY LOOP
        IF jsonb_typeof(v_attendee) = 'object' THEN
            v_id := v_kept[v_ord];
            IF v_id IS NULL THEN
                SELECT o.value->>'id' INTO v_id
                FROM jsonb_array_elements(v_old) WITH ORDINALITY AS o(value, ord)
                WHERE jsonb_typeof(o.value) = 'object'
                  AND o.value->>'id' IS NOT NULL
                  AND btrim(o.value->>'name') = btrim(v_attendee->>'name')
                  AND NOT ((o.value->>'id') = ANY (v_used))
                ORDER BY o.ord
                LIMIT 1;
                v_id := COALESCE(v_id, gen_random_uuid()::text);
                v_used := v_used || v_id;
            END IF;
            -- Only touch the key when it differs, so an unchanged attendee stays byte-identical.
            IF v_attendee->>'id' IS DISTINCT FROM v_id THEN
                v_attendee := jsonb_set(v_attendee, '{id}', to_jsonb(v_id));
            END IF;
        END IF;
        v_attendees := v_attendees || jsonb_build_array(v_attendee);
    END LOOP;

    IF v_attendees IS DISTINCT FROM NEW.attendees THEN
        NEW.attendees := v_attendees;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.assign_attendee_ids() OWNER TO "postgres";

CREATE TRIGGER trg_assign_attendee_ids
BEFORE INSERT OR UPDATE ON public.user_parties
FOR EACH ROW
EXECUTE FUNCTION public.assign_attendee_ids();

-- Backfill. With the table's triggers off: giving ids is not an edit (no edit_count, no audit
-- row, no email, no repricing), and the close-date lock must not refuse it.
ALTER TABLE public.user_parties DISABLE TRIGGER USER;

UPDATE public.user_parties p
SET attendees = (
    SELECT jsonb_agg(
        CASE
            WHEN jsonb_typeof(a.value) = 'object' AND a.value->>'id' IS NULL
                THEN a.value || jsonb_build_object('id', gen_random_uuid())
            ELSE a.value
        END
        ORDER BY a.ord
    )
    FROM jsonb_array_elements(p.attendees) WITH ORDINALITY AS a(value, ord)
)
WHERE jsonb_typeof(p.attendees) = 'array'
  AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p.attendees) AS a(value)
      WHERE jsonb_typeof(a.value) = 'object' AND a.value->>'id' IS NULL
  );

ALTER TABLE public.user_parties ENABLE TRIGGER USER;

-- 3. #94, by id --------------------------------------------------------------------------------

-- Same as #94's version, except that a member's attendee gets back the stored bed of the attendee
-- with the same id rather than the same name: trg_assign_attendee_ids has already matched ids
-- (by id, then by name), so a renamed attendee keeps their bed now.
CREATE OR REPLACE FUNCTION public.protect_admin_only_party_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_attendee jsonb;
    v_attendees jsonb := '[]'::jsonb;
    v_bed text;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' AND auth.role() IS DISTINCT FROM 'anon' THEN
        RETURN NEW;
    END IF;
    IF public.is_admin() THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.payment_status := 'unpaid';
        NEW.admin_notes := NULL;
    ELSE
        NEW.payment_status := OLD.payment_status;
        NEW.admin_notes := OLD.admin_notes;
        IF NEW.attendees IS NOT DISTINCT FROM OLD.attendees THEN
            RETURN NEW;
        END IF;
    END IF;

    IF jsonb_typeof(NEW.attendees) IS DISTINCT FROM 'array' THEN
        RETURN NEW;
    END IF;

    FOR v_attendee IN SELECT value FROM jsonb_array_elements(NEW.attendees) LOOP
        v_bed := '';
        IF TG_OP = 'UPDATE' AND jsonb_typeof(OLD.attendees) = 'array' THEN
            SELECT COALESCE(o.value->>'assigned_bed', '') INTO v_bed
            FROM jsonb_array_elements(OLD.attendees) AS o(value)
            WHERE jsonb_typeof(o.value) = 'object' AND o.value->>'id' = v_attendee->>'id'
            LIMIT 1;
            v_bed := COALESCE(v_bed, '');
        END IF;

        IF jsonb_typeof(v_attendee) = 'object'
           AND COALESCE(v_attendee->>'assigned_bed', '') IS DISTINCT FROM v_bed THEN
            v_attendee := jsonb_set(v_attendee, '{assigned_bed}', to_jsonb(v_bed));
        END IF;
        v_attendees := v_attendees || jsonb_build_array(v_attendee);
    END LOOP;

    NEW.attendees := v_attendees;
    RETURN NEW;
END;
$$;

-- 4. The assigned_bed mirror -------------------------------------------------------------------

-- attendees with each assigned_bed set from the party's assignments ('' for anyone unassigned,
-- and for everyone when the party is inactive: cancelled or waitlisted).
CREATE FUNCTION private.mirror_assigned_beds(p_party_id uuid, p_attendees jsonb, p_inactive boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_labels jsonb;
    v_attendee jsonb;
    v_attendees jsonb := '[]'::jsonb;
    v_bed text;
BEGIN
    IF jsonb_typeof(p_attendees) IS DISTINCT FROM 'array' THEN
        RETURN p_attendees;
    END IF;

    SELECT COALESCE(jsonb_object_agg(a.attendee_id::text, l.name || ' · ' || pl.label), '{}'::jsonb)
    INTO v_labels
    FROM public.place_assignments a
    JOIN public.event_places pl ON pl.id = a.place_id
    JOIN public.event_locations l ON l.id = pl.location_id
    WHERE a.party_id = p_party_id AND NOT p_inactive;

    FOR v_attendee IN SELECT value FROM jsonb_array_elements(p_attendees) LOOP
        IF jsonb_typeof(v_attendee) = 'object' THEN
            v_bed := COALESCE(v_labels->>(v_attendee->>'id'), '');
            IF COALESCE(v_attendee->>'assigned_bed', '') IS DISTINCT FROM v_bed THEN
                v_attendee := jsonb_set(v_attendee, '{assigned_bed}', to_jsonb(v_bed));
            END IF;
        END IF;
        v_attendees := v_attendees || jsonb_build_array(v_attendee);
    END LOOP;
    RETURN v_attendees;
END;
$$;

REVOKE ALL ON FUNCTION private.mirror_assigned_beds(uuid, jsonb, boolean) FROM PUBLIC;

-- Re-mirrors the given parties, writing only the ones whose labels actually change.
CREATE FUNCTION private.resync_assigned_beds(p_party_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    UPDATE public.user_parties p
    SET attendees = private.mirror_assigned_beds(p.id, p.attendees, p.status = 'cancelled' OR p.is_waitlisted)
    WHERE p.id = ANY (p_party_ids)
      AND p.attendees IS DISTINCT FROM
          private.mirror_assigned_beds(p.id, p.attendees, p.status = 'cancelled' OR p.is_waitlisted);
$$;

REVOKE ALL ON FUNCTION private.resync_assigned_beds(uuid[]) FROM PUBLIC;

-- On an event with locations, assigned_bed is whatever the assignments say, whoever writes.
CREATE FUNCTION private.sync_assigned_bed_from_places()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.event_locations WHERE event_id = NEW.event_id) THEN
        RETURN NEW;
    END IF;
    NEW.attendees := private.mirror_assigned_beds(
        NEW.id, NEW.attendees, NEW.status = 'cancelled' OR NEW.is_waitlisted
    );
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_assigned_bed_from_places() FROM PUBLIC;

CREATE TRIGGER trg_sync_assigned_bed_from_places
BEFORE INSERT OR UPDATE ON public.user_parties
FOR EACH ROW
EXECUTE FUNCTION private.sync_assigned_bed_from_places();

-- A cancelled or waitlisted party frees its places; an attendee removed from the party frees theirs.
CREATE FUNCTION private.release_stale_place_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'cancelled' OR NEW.is_waitlisted THEN
        DELETE FROM public.place_assignments WHERE party_id = NEW.id;
    ELSE
        DELETE FROM public.place_assignments a
        WHERE a.party_id = NEW.id
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(NEW.attendees) = 'array' THEN NEW.attendees ELSE '[]'::jsonb END
              ) AS e(value)
              WHERE jsonb_typeof(e.value) = 'object' AND e.value->>'id' = a.attendee_id::text
          );
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.release_stale_place_assignments() FROM PUBLIC;

CREATE TRIGGER trg_release_stale_place_assignments
AFTER UPDATE ON public.user_parties
FOR EACH ROW
WHEN (
    OLD.attendees IS DISTINCT FROM NEW.attendees
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.is_waitlisted IS DISTINCT FROM NEW.is_waitlisted
)
EXECUTE FUNCTION private.release_stale_place_assignments();

-- 5. Assignment rules and propagation ----------------------------------------------------------

-- Only an attendee of an active party, to a place of the party's own event.
CREATE FUNCTION private.enforce_place_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_party public.user_parties%ROWTYPE;
    v_place_event uuid;
BEGIN
    SELECT * INTO v_party FROM public.user_parties WHERE id = NEW.party_id;

    IF v_party.status = 'cancelled' OR v_party.is_waitlisted THEN
        RAISE EXCEPTION USING MESSAGE = 'place_assignment_party_inactive', ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(v_party.attendees) = 'array' THEN v_party.attendees ELSE '[]'::jsonb END
        ) AS e(value)
        WHERE jsonb_typeof(e.value) = 'object' AND e.value->>'id' = NEW.attendee_id::text
    ) THEN
        RAISE EXCEPTION USING MESSAGE = 'place_assignment_unknown_attendee', ERRCODE = 'check_violation';
    END IF;

    SELECT l.event_id INTO v_place_event
    FROM public.event_places pl
    JOIN public.event_locations l ON l.id = pl.location_id
    WHERE pl.id = NEW.place_id;

    IF v_place_event IS DISTINCT FROM v_party.event_id THEN
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

-- Any change to who is where re-mirrors the parties involved.
CREATE FUNCTION private.resync_after_assignment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM private.resync_assigned_beds(ARRAY[NEW.party_id]);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM private.resync_assigned_beds(ARRAY[OLD.party_id]);
    ELSE
        PERFORM private.resync_assigned_beds(ARRAY[OLD.party_id, NEW.party_id]);
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.resync_after_assignment_change() FROM PUBLIC;

CREATE TRIGGER trg_resync_after_assignment_change
AFTER INSERT OR UPDATE OR DELETE ON public.place_assignments
FOR EACH ROW
EXECUTE FUNCTION private.resync_after_assignment_change();

-- Renaming a place or a location (or moving a place) re-mirrors the parties in it.
CREATE FUNCTION private.resync_after_place_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.resync_assigned_beds(ARRAY(
        SELECT DISTINCT a.party_id
        FROM public.place_assignments a
        JOIN public.event_places pl ON pl.id = a.place_id
        WHERE (TG_TABLE_NAME = 'event_places' AND pl.id = NEW.id)
           OR (TG_TABLE_NAME = 'event_locations' AND pl.location_id = NEW.id)
    ));
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.resync_after_place_change() FROM PUBLIC;

CREATE TRIGGER trg_resync_after_place_change
AFTER UPDATE OF label, location_id ON public.event_places
FOR EACH ROW
WHEN (OLD.label IS DISTINCT FROM NEW.label OR OLD.location_id IS DISTINCT FROM NEW.location_id)
EXECUTE FUNCTION private.resync_after_place_change();

CREATE TRIGGER trg_resync_after_location_rename
AFTER UPDATE OF name ON public.event_locations
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION private.resync_after_place_change();

-- An event's first location ends free-text beds: its parties' labels are cleared (the resync
-- finds no assignment). has_assigned_bed() goes from true to false, which requests no email, and
-- a later assignment finds 'accommodation' already in email_log, so nobody is emailed twice.
-- Later locations find nothing to change.
CREATE FUNCTION private.clear_free_text_beds_on_new_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.resync_assigned_beds(ARRAY(
        SELECT p.id FROM public.user_parties p
        WHERE p.event_id = NEW.event_id AND private.has_assigned_bed(p.attendees)
    ));
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.clear_free_text_beds_on_new_location() FROM PUBLIC;

CREATE TRIGGER trg_clear_free_text_beds_on_new_location
AFTER INSERT ON public.event_locations
FOR EACH ROW
EXECUTE FUNCTION private.clear_free_text_beds_on_new_location();
