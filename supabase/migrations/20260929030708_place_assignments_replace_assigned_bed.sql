-- #114 (part 2 of #112): place assignments replace the free-text attendees.assigned_bed.
--
-- #113 added locations, places and place_assignments alongside the free-text column. Now the
-- Logistique tab assigns places, every reader uses the attendee_places view, and the column goes:
-- there are no free-text beds any more (decided 2026-09-29; this reverses #112's "events without
-- locations keep free text"). Production had one label, on a party already sent its
-- accommodation email; it is discarded.
--
-- What read or guarded the column:
--   * the accommodation email trigger: now fires when an attendee is given a place;
--   * guard_attendee_write(): loses its "an admin may change only the bed" exception;
--   * attendees_snapshot() (edit history): no bed any more. Older history rows keep theirs,
--     and nothing displays it.

-- ---------------------------------------------------------------------------------------------
-- The accommodation email (ADR 0016). The Edge Function decides from the committed state what a
-- party is owed and sends each template once, so asking again on a reassignment is harmless.
-- Called from user_parties (its id) and from place_assignments (the attendee's party).

CREATE OR REPLACE FUNCTION private.request_party_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_url text;
    v_party_id uuid;
BEGIN
    SELECT "value" INTO v_url FROM private.settings WHERE "key" = 'email_function_url';
    IF v_url IS NULL THEN
        RETURN NULL;
    END IF;

    IF TG_TABLE_NAME = 'place_assignments' THEN
        SELECT party_id INTO v_party_id FROM public.attendees WHERE id = NEW.attendee_id;
    ELSE
        v_party_id := NEW.id;
    END IF;

    PERFORM net.http_post(
        url := v_url,
        body := jsonb_build_object('party_id', v_party_id),
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 10000
    );
    RETURN NULL;
END;
$$;

DROP TRIGGER trg_request_party_email_on_bed ON public.attendees;

CREATE TRIGGER trg_request_party_email_on_place
AFTER INSERT ON public.place_assignments
FOR EACH ROW
EXECUTE FUNCTION private.request_party_email();

-- ---------------------------------------------------------------------------------------------
-- Attendees are written only through save_registration() now, admins included.

CREATE OR REPLACE FUNCTION private.guard_attendee_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_saving text := current_setting('bedaine.saving_party', true);
BEGIN
    -- Migrations, the service role and direct database sessions are trusted.
    IF auth.role() IS DISTINCT FROM 'authenticated' AND auth.role() IS DISTINCT FROM 'anon' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- The cascade from deleting the party (admins only): the party row is already gone.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.user_parties WHERE id = OLD.party_id) THEN
        RETURN OLD;
    END IF;

    IF (TG_OP = 'INSERT' OR OLD.party_id::text = v_saving)
       AND (TG_OP = 'DELETE' OR NEW.party_id::text = v_saving) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    RAISE EXCEPTION USING
        MESSAGE = 'attendees_write_through_save_registration',
        ERRCODE = '42501';
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- The edit history's snapshot, without the bed.

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
    WHERE a.party_id = p_party_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- The column. Deployed in one step with the frontend that stops reading it: a tab still on the
-- previous frontend fails to load or save beds until it reloads.

-- squawk-ignore ban-drop-column
ALTER TABLE public.attendees DROP COLUMN assigned_bed;
