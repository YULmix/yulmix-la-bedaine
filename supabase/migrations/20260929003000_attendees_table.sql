-- Attendees move out of the user_parties.attendees JSON array into their own table (#126,
-- ADR 0018, which supersedes ADR 0004). One row per attendee, referenced by foreign key; the party
-- keeps no derived copy of attendee data (counts, logistics.sleeping, logistics.food_requests).
--
-- The registration form now saves through one function, save_registration(), because PostgREST
-- can't write a party and its attendees in one transaction. It is SECURITY INVOKER, so the RLS of
-- user_parties and attendees still decides who may write what. A trigger on attendees refuses any
-- other write path (except an admin changing a bed label), which keeps the party-level rules (amount
-- owed, waitlist, close-date lock, audit log) in one place.
--
-- Also fixes #118: the capacity check counted other parties under the writer's RLS, so a member
-- was never waitlisted. The headcount now runs as SECURITY DEFINER.
--
-- Deployed in one step (no expand/contract): a tab still running the previous frontend gets an
-- error on save until it reloads.

-- ---------------------------------------------------------------------------------------------
-- The table.

CREATE TABLE public.attendees (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "party_id" uuid NOT NULL REFERENCES public.user_parties(id) ON DELETE CASCADE,
    -- Display order within the party, from 1. Deferred so save_registration() can reorder.
    "position" integer NOT NULL CHECK ("position" > 0),
    "name" text NOT NULL CHECK (btrim("name") <> ''),
    "type" text NOT NULL CHECK ("type" IN ('Adult', 'Teenager', 'Kid')),
    "participation" text NOT NULL CHECK ("participation" IN ('Whole', 'Main', 'After-Party')),
    "is_new_member" boolean NOT NULL DEFAULT false,
    -- '' means "not answered", as it did in the JSON; the form and every reader rely on it.
    "sleeping_preference" text NOT NULL DEFAULT ''
        CHECK ("sleeping_preference" IN ('', 'camping', 'floor', 'bed', 'sofa', 'outside_other')),
    "sleeping_preference_other" text NOT NULL DEFAULT '',
    "bed_reason" text NOT NULL DEFAULT ''
        CHECK ("bed_reason" IN ('', 'health', 'children', 'comfort', 'other')),
    "bed_reason_other" text NOT NULL DEFAULT '',
    "dietary_needs" text NOT NULL DEFAULT ''
        CHECK ("dietary_needs" IN ('', 'none', 'vegetarian', 'vegan', 'gluten_free', 'other')),
    "dietary_other" text NOT NULL DEFAULT '',
    -- Free-text bed label set by an admin (#94). Replaced by place assignments in #113.
    "assigned_bed" text NOT NULL DEFAULT '',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendees_party_id_position_key UNIQUE ("party_id", "position") DEFERRABLE INITIALLY DEFERRED
);

COMMENT ON TABLE public.attendees IS
    'One row per person in a registration (user_parties). Written only through save_registration(); see ADR 0018.';

-- Same access as the party: the subquery runs under user_parties' own RLS, so a member sees and
-- writes their own party's attendees and an admin all of them.
ALTER TABLE public.attendees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Attendees: same access as their party" ON public.attendees
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_parties up WHERE up.id = party_id))
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_parties up WHERE up.id = party_id));

REVOKE ALL ON TABLE public.attendees FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendees TO authenticated;
-- The send-party-email Edge Function reads attendee names and beds with the service role.
GRANT SELECT ON TABLE public.attendees TO service_role;

-- ---------------------------------------------------------------------------------------------
-- Backfill, keeping the array order as position. Nothing below the table exists yet, so no
-- trigger fires here.

INSERT INTO public.attendees (
    party_id, "position", "name", "type", participation, is_new_member,
    sleeping_preference, sleeping_preference_other, bed_reason, bed_reason_other,
    dietary_needs, dietary_other, assigned_bed
)
SELECT
    up.id,
    a.ord,
    btrim(a.value->>'name'),
    a.value->>'type',
    COALESCE(NULLIF(a.value->>'participation', ''), CASE WHEN a.value->>'type' = 'Kid' THEN 'After-Party' ELSE 'Whole' END),
    COALESCE((a.value->>'is_new_member')::boolean, false),
    COALESCE(a.value->>'sleeping_preference', ''),
    COALESCE(a.value->>'sleeping_preference_other', ''),
    COALESCE(a.value->>'bed_reason', ''),
    COALESCE(a.value->>'bed_reason_other', ''),
    COALESCE(a.value->>'dietary_needs', ''),
    COALESCE(a.value->>'dietary_other', ''),
    COALESCE(btrim(a.value->>'assigned_bed'), '')
FROM public.user_parties up
CROSS JOIN LATERAL jsonb_array_elements(up.attendees) WITH ORDINALITY AS a(value, ord);

-- ---------------------------------------------------------------------------------------------
-- Helpers the triggers and save_registration() share.

-- A party's attendees as the JSON array registration_edits has always stored, so the member's
-- edit history (src/lib/editHistory.js) reads old and new entries the same way.
CREATE FUNCTION private.attendees_snapshot(p_party_id uuid)
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
        'dietary_other', a.dietary_other,
        'assigned_bed', a.assigned_bed
    ) ORDER BY a.position), '[]'::jsonb)
    FROM public.attendees a
    WHERE a.party_id = p_party_id;
$$;

-- What a party owes at a given price. Same rules as attendeePrice() in src/lib/pricingEngine.js:
-- newbies pay the main-event share whatever they picked, teens half, kids nothing, and each
-- attendee is rounded up to the dollar (#120).
CREATE FUNCTION private.party_amount_owed(p_party_id uuid, p_selling_price_whole_event numeric, p_ratio_main_whole numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_selling_price_whole_event IS NULL OR p_selling_price_whole_event <= 0 THEN 0
        ELSE COALESCE(SUM(CEIL(
            CASE
                WHEN a.type IN ('Adult', 'Teenager') THEN
                    (CASE WHEN a.participation = 'Whole' AND NOT a.is_new_member THEN 1 ELSE p_ratio_main_whole END)
                    * (CASE WHEN a.type = 'Teenager' THEN 0.5 ELSE 1 END)
                ELSE 0
            END * p_selling_price_whole_event
        )), 0)
    END
    FROM public.attendees a
    WHERE a.party_id = p_party_id;
$$;

-- People counted against an event's capacity: attendees of its registered, non-waitlisted parties.
-- SECURITY DEFINER because a member's RLS hides the other parties (#118).
CREATE FUNCTION private.event_headcount(p_event_id uuid, p_exclude_party_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(*)::integer
    FROM public.attendees a
    JOIN public.user_parties up ON up.id = a.party_id
    WHERE up.event_id = p_event_id
      AND up.is_waitlisted = FALSE
      AND up.status IN ('registered', 'pending')
      AND up.id IS DISTINCT FROM p_exclude_party_id;
$$;

CREATE FUNCTION private.party_size(p_party_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT count(*)::integer FROM public.attendees WHERE party_id = p_party_id;
$$;

-- Past the event's close date (start date minus x_reg_close_weeks): members can no longer cancel
-- or remove attendees. No start date or no close weeks: never locked.
CREATE FUNCTION private.registration_closed(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(CURRENT_DATE > e.event_start_date - (e.x_reg_close_weeks * 7), false)
    FROM public.events e
    WHERE e.id = p_event_id;
$$;

REVOKE ALL ON FUNCTION private.attendees_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.party_amount_owed(uuid, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.event_headcount(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.party_size(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.registration_closed(uuid) FROM PUBLIC;
-- Called by triggers and save_registration() as whoever is writing.
GRANT EXECUTE ON FUNCTION private.attendees_snapshot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.party_amount_owed(uuid, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.event_headcount(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.party_size(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.registration_closed(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The move must not change what anyone owes, nor who is in which party in which order. Checked
-- against the JSON before it is dropped; any difference aborts the migration.

DO $$
DECLARE
    v_bad record;
BEGIN
    SELECT up.id INTO v_bad
    FROM public.user_parties up
    WHERE public.calculate_party_amount_owed(up.attendees, COALESCE(up.locked_selling_price_whole_event, 0), COALESCE(up.locked_ratio_main_whole, 0.5375))
          IS DISTINCT FROM private.party_amount_owed(up.id, COALESCE(up.locked_selling_price_whole_event, 0), COALESCE(up.locked_ratio_main_whole, 0.5375))
       OR (SELECT jsonb_agg(btrim(e->>'name')) FROM jsonb_array_elements(up.attendees) e)
          IS DISTINCT FROM (SELECT jsonb_agg(a.name ORDER BY a.position) FROM public.attendees a WHERE a.party_id = up.id)
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'attendees backfill changed party %', v_bad.id;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- The only way in. save_registration() marks the party it is saving for the rest of the
-- transaction; clients can't set that setting themselves (PostgREST exposes no set_config).

CREATE FUNCTION private.guard_attendee_write()
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
        -- save_registration() never sets a bed; keep whatever an admin assigned.
        IF TG_OP = 'INSERT' AND NOT public.is_admin() THEN
            NEW.assigned_bed := '';
        ELSIF TG_OP = 'UPDATE' THEN
            NEW.assigned_bed := OLD.assigned_bed;
        END IF;
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- An admin assigning a bed changes nothing else, so it needs no recomputation.
    IF TG_OP = 'UPDATE' AND public.is_admin()
       AND to_jsonb(NEW) - 'assigned_bed' = to_jsonb(OLD) - 'assigned_bed' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION USING
        MESSAGE = 'attendees_write_through_save_registration',
        ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.guard_attendee_write() FROM PUBLIC;

CREATE TRIGGER trg_guard_attendee_write
BEFORE INSERT OR UPDATE OR DELETE ON public.attendees
FOR EACH ROW
EXECUTE FUNCTION private.guard_attendee_write();

-- The accommodation email (ADR 0016) used to fire when the party's JSON gained a bed. The Edge
-- Function decides what is owed from the committed state and sends each template once, so
-- calling it for each newly assigned attendee is harmless.
CREATE OR REPLACE FUNCTION private.request_party_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_url text;
BEGIN
    SELECT "value" INTO v_url FROM private.settings WHERE "key" = 'email_function_url';
    IF v_url IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM net.http_post(
        url := v_url,
        -- Called from user_parties (its id) and from attendees (its party_id).
        body := jsonb_build_object('party_id', COALESCE(to_jsonb(NEW)->>'party_id', NEW.id::text)),
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 10000
    );
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_request_party_email_on_bed
AFTER UPDATE OF assigned_bed ON public.attendees
FOR EACH ROW
WHEN (NEW.assigned_bed ~ '\S' AND OLD.assigned_bed !~ '\S')
EXECUTE FUNCTION private.request_party_email();

DROP TRIGGER trg_request_party_email_on_update ON public.user_parties;
CREATE TRIGGER trg_request_party_email_on_update
AFTER UPDATE ON public.user_parties
FOR EACH ROW
WHEN (
    OLD.is_waitlisted IS DISTINCT FROM NEW.is_waitlisted
    OR OLD.payment_status IS DISTINCT FROM NEW.payment_status
    OR OLD.status IS DISTINCT FROM NEW.status
)
EXECUTE FUNCTION private.request_party_email();

DROP FUNCTION private.has_assigned_bed(jsonb);

-- ---------------------------------------------------------------------------------------------
-- The party triggers read the table instead of the JSON.

CREATE OR REPLACE FUNCTION public.enforce_calculated_amount_owed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_event public.events%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT'
       OR NEW.event_id IS DISTINCT FROM OLD.event_id
       OR (OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled') THEN
        NEW.locked_selling_price_whole_event := NULL;
        NEW.locked_ratio_main_whole := NULL;
    ELSE
        NEW.locked_selling_price_whole_event := OLD.locked_selling_price_whole_event;
        NEW.locked_ratio_main_whole := OLD.locked_ratio_main_whole;
    END IF;

    IF NEW.locked_selling_price_whole_event IS NULL THEN
        SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;
        IF v_event.selling_price_whole_event > 0 THEN
            NEW.locked_selling_price_whole_event := v_event.selling_price_whole_event;
            NEW.locked_ratio_main_whole := COALESCE(v_event.ratio_main_whole, 0.5375);
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.payment_status = 'paid' THEN
        NEW.calculated_amount_owed := OLD.calculated_amount_owed;
        RETURN NEW;
    END IF;

    -- On INSERT the party has no attendees yet; save_registration() adds them, then updates the
    -- party, which runs this again.
    NEW.calculated_amount_owed := private.party_amount_owed(
        NEW.id,
        COALESCE(NEW.locked_selling_price_whole_event, 0),
        COALESCE(NEW.locked_ratio_main_whole, 0.5375)
    );

    RETURN NEW;
END;
$$;

DROP FUNCTION public.calculate_party_amount_owed(jsonb, numeric, numeric);

CREATE OR REPLACE FUNCTION public.enforce_capacity_and_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_max_attendees INT;
BEGIN
    SELECT max_attendees INTO v_max_attendees
    FROM public.events
    WHERE id = NEW.event_id;

    IF v_max_attendees IS NULL OR v_max_attendees <= 0 THEN
        NEW.is_waitlisted := FALSE;
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(NEW.event_id::text));

    NEW.is_waitlisted := private.event_headcount(NEW.event_id, NEW.id) + private.party_size(NEW.id) > v_max_attendees;

    RETURN NEW;
END;
$$;

-- Attendee changes reach the party through save_registration(), whose final UPDATE sets status.
DROP TRIGGER trg_enforce_capacity_and_waitlist ON public.user_parties;
CREATE TRIGGER trg_enforce_capacity_and_waitlist
BEFORE INSERT OR UPDATE OF status ON public.user_parties
FOR EACH ROW
EXECUTE FUNCTION public.enforce_capacity_and_waitlist();

CREATE OR REPLACE FUNCTION public.promote_waitlisted_parties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_max_attendees INT;
    v_remaining_capacity INT;
    v_party RECORD;
BEGIN
    SELECT max_attendees INTO v_max_attendees
    FROM public.events
    WHERE id = NEW.event_id;

    IF v_max_attendees IS NULL OR v_max_attendees <= 0 THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(NEW.event_id::text));

    v_remaining_capacity := v_max_attendees - private.event_headcount(NEW.event_id);

    IF v_remaining_capacity <= 0 THEN
        RETURN NEW;
    END IF;

    FOR v_party IN
        SELECT up.id, private.party_size(up.id) AS size
        FROM public.user_parties up
        WHERE up.event_id = NEW.event_id
          AND up.is_waitlisted = TRUE
          AND up.status IN ('registered', 'pending')
        ORDER BY up.created_at ASC
    LOOP
        EXIT WHEN v_party.size > v_remaining_capacity;

        UPDATE public.user_parties
        SET is_waitlisted = FALSE
        WHERE id = v_party.id;

        v_remaining_capacity := v_remaining_capacity - v_party.size;

        EXIT WHEN v_remaining_capacity <= 0;
    END LOOP;

    RETURN NEW;
END;
$$;

-- Removing an attendee after the close date moved to save_registration(), the only place that
-- sees a party's attendees before and after a save.
CREATE OR REPLACE FUNCTION public.enforce_registration_lock_after_close_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF public.is_admin() OR NOT private.registration_closed(OLD.event_id) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'DELETE'
       OR (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled') THEN
        RAISE EXCEPTION 'Les inscriptions sont verrouillées: la date limite de désinscription pour cet événement est passée. Le montant dû reste exigible. Contactez un organisateur pour toute exception.';
    END IF;

    RETURN NEW;
END;
$$;

-- Beds are on attendees now, protected by guard_attendee_write().
CREATE OR REPLACE FUNCTION public.protect_admin_only_party_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
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
    END IF;
    RETURN NEW;
END;
$$;

-- Creating a registration inserts the party, then its attendees, then updates the party to
-- compute what depends on them. That update is part of the creation, not an edit.
CREATE FUNCTION private.is_creating_party(p_party_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT current_setting('bedaine.saving_party', true) = p_party_id::text
       AND current_setting('bedaine.attendees_before', true) = 'new';
$$;

REVOKE ALL ON FUNCTION private.is_creating_party(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_creating_party(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.increment_edit_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF private.is_creating_party(NEW.id) THEN
        NEW.edit_count := OLD.edit_count;
        NEW.last_edited_at := OLD.last_edited_at;
        RETURN NEW;
    END IF;
    NEW.edit_count = OLD.edit_count + 1;
    NEW.last_edited_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_registration_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    changes_json JSONB := '{}'::JSONB;
    v_attendees_after JSONB;
BEGIN
    IF private.is_creating_party(NEW.id) THEN
        RETURN NEW;
    END IF;

    -- save_registration() left the attendees as they were before the save.
    IF current_setting('bedaine.saving_party', true) = NEW.id::text THEN
        v_attendees_after := private.attendees_snapshot(NEW.id);
        IF current_setting('bedaine.attendees_before', true)::jsonb IS DISTINCT FROM v_attendees_after THEN
            changes_json = jsonb_set(changes_json, '{attendees}', jsonb_build_object(
                'old', current_setting('bedaine.attendees_before', true)::jsonb,
                'new', v_attendees_after
            ));
        END IF;
    END IF;
    IF OLD.logistics IS DISTINCT FROM NEW.logistics THEN
        changes_json = jsonb_set(changes_json, '{logistics}', jsonb_build_object('old', OLD.logistics, 'new', NEW.logistics));
    END IF;
    IF OLD.transport IS DISTINCT FROM NEW.transport THEN
        changes_json = jsonb_set(changes_json, '{transport}', jsonb_build_object('old', OLD.transport, 'new', NEW.transport));
    END IF;
    IF OLD.music_requests IS DISTINCT FROM NEW.music_requests THEN
        changes_json = jsonb_set(changes_json, '{music_requests}', jsonb_build_object('old', OLD.music_requests, 'new', NEW.music_requests));
    END IF;
    IF OLD.message_to_organizers IS DISTINCT FROM NEW.message_to_organizers THEN
        changes_json = jsonb_set(changes_json, '{message_to_organizers}', jsonb_build_object('old', OLD.message_to_organizers, 'new', NEW.message_to_organizers));
    END IF;
    IF OLD.confirmation_message IS DISTINCT FROM NEW.confirmation_message THEN
        changes_json = jsonb_set(changes_json, '{confirmation_message}', jsonb_build_object('old', OLD.confirmation_message, 'new', NEW.confirmation_message));
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        changes_json = jsonb_set(changes_json, '{status}', jsonb_build_object('old', OLD.status, 'new', NEW.status));
    END IF;
    IF OLD.calculated_amount_owed IS DISTINCT FROM NEW.calculated_amount_owed THEN
        changes_json = jsonb_set(changes_json, '{calculated_amount_owed}', jsonb_build_object('old', OLD.calculated_amount_owed, 'new', NEW.calculated_amount_owed));
    END IF;
    IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
        changes_json = jsonb_set(changes_json, '{payment_status}', jsonb_build_object('old', OLD.payment_status, 'new', NEW.payment_status));
    END IF;
    IF OLD.is_waitlisted IS DISTINCT FROM NEW.is_waitlisted THEN
        changes_json = jsonb_set(changes_json, '{is_waitlisted}', jsonb_build_object('old', OLD.is_waitlisted, 'new', NEW.is_waitlisted));
    END IF;
    IF OLD.admin_notes IS DISTINCT FROM NEW.admin_notes THEN
        changes_json = jsonb_set(changes_json, '{admin_notes}', jsonb_build_object('old', OLD.admin_notes, 'new', NEW.admin_notes));
    END IF;

    IF changes_json != '{}'::JSONB THEN
        INSERT INTO public.registration_edits (registration_id, edited_by, changes)
        VALUES (NEW.id, auth.uid(), changes_json);
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- The write path.
--
--   p_event_id   the event
--   p_attendees  the full list, in display order. An entry with the id of one of this party's
--                attendees updates it; any other entry is a new attendee; attendees left out
--                are removed. Keys: id, name, type, participation, is_new_member,
--                sleeping_preference(_other), bed_reason(_other), dietary_needs, dietary_other.
--   p_party      party-wide fields to set: logistics, transport, music_requests,
--                message_to_organizers; plus id, used only when creating the party.
--   p_user_id    whose registration; defaults to the caller. Only an admin can save someone
--                else's (RLS on user_parties decides).
--
-- Saving registers: a cancelled party saved again is registered again (#35). Amount owed, price
-- lock, waitlist and audit log come from the party's triggers.

CREATE FUNCTION public.save_registration(
    p_event_id uuid,
    p_attendees jsonb,
    p_party jsonb DEFAULT '{}'::jsonb,
    p_user_id uuid DEFAULT NULL
)
RETURNS public.user_parties
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := COALESCE(p_user_id, auth.uid());
    v_party public.user_parties;
    v_before jsonb;
    v_size_before integer;
    v_input jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'not_authenticated';
    END IF;
    IF jsonb_typeof(p_attendees) IS DISTINCT FROM 'array' OR jsonb_array_length(p_attendees) = 0 THEN
        RAISE EXCEPTION USING MESSAGE = 'attendees_required', ERRCODE = '22023';
    END IF;

    SELECT * INTO v_party
    FROM public.user_parties
    WHERE user_id = v_user_id AND event_id = p_event_id
    FOR UPDATE;

    IF FOUND THEN
        v_before := private.attendees_snapshot(v_party.id);
        v_size_before := jsonb_array_length(v_before);
    ELSE
        INSERT INTO public.user_parties (id, user_id, event_id)
        VALUES (COALESCE((p_party->>'id')::uuid, gen_random_uuid()), v_user_id, p_event_id)
        RETURNING * INTO v_party;
    END IF;

    PERFORM set_config('bedaine.saving_party', v_party.id::text, true);
    PERFORM set_config('bedaine.attendees_before', COALESCE(v_before::text, 'new'), true);

    -- Match entries to this party's attendees by id; the first entry with a given id wins.
    SELECT jsonb_agg(jsonb_build_object('ord', m.ord, 'existing_id', m.existing_id, 'entry', m.entry))
    INTO v_input
    FROM (
        SELECT i.ord,
               CASE WHEN row_number() OVER (PARTITION BY a.id ORDER BY i.ord) = 1 THEN a.id END AS existing_id,
               i.entry
        FROM jsonb_array_elements(p_attendees) WITH ORDINALITY AS i(entry, ord)
        LEFT JOIN public.attendees a
          ON a.party_id = v_party.id
         AND a.id::text = i.entry->>'id'
    ) m;

    DELETE FROM public.attendees a
    WHERE a.party_id = v_party.id
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_to_recordset(v_input) AS r(existing_id uuid) WHERE r.existing_id = a.id
      );

    UPDATE public.attendees a
    SET "position" = r.ord,
        "name" = btrim(r.entry->>'name'),
        "type" = r.entry->>'type',
        participation = r.entry->>'participation',
        is_new_member = COALESCE((r.entry->>'is_new_member')::boolean, false),
        sleeping_preference = COALESCE(r.entry->>'sleeping_preference', ''),
        sleeping_preference_other = COALESCE(r.entry->>'sleeping_preference_other', ''),
        bed_reason = COALESCE(r.entry->>'bed_reason', ''),
        bed_reason_other = COALESCE(r.entry->>'bed_reason_other', ''),
        dietary_needs = COALESCE(r.entry->>'dietary_needs', ''),
        dietary_other = COALESCE(r.entry->>'dietary_other', '')
    FROM jsonb_to_recordset(v_input) AS r(ord integer, existing_id uuid, entry jsonb)
    WHERE r.existing_id = a.id;

    INSERT INTO public.attendees (
        party_id, "position", "name", "type", participation, is_new_member,
        sleeping_preference, sleeping_preference_other, bed_reason, bed_reason_other,
        dietary_needs, dietary_other
    )
    SELECT v_party.id, r.ord, btrim(r.entry->>'name'), r.entry->>'type', r.entry->>'participation',
           COALESCE((r.entry->>'is_new_member')::boolean, false),
           COALESCE(r.entry->>'sleeping_preference', ''),
           COALESCE(r.entry->>'sleeping_preference_other', ''),
           COALESCE(r.entry->>'bed_reason', ''),
           COALESCE(r.entry->>'bed_reason_other', ''),
           COALESCE(r.entry->>'dietary_needs', ''),
           COALESCE(r.entry->>'dietary_other', '')
    FROM jsonb_to_recordset(v_input) AS r(ord integer, existing_id uuid, entry jsonb)
    WHERE r.existing_id IS NULL
    ORDER BY r.ord;

    -- After the close date a member can't shrink an active party: what it owes stays owed.
    IF v_size_before IS NOT NULL
       AND v_party.status IS DISTINCT FROM 'cancelled'
       AND jsonb_array_length(p_attendees) < v_size_before
       AND NOT public.is_admin()
       AND private.registration_closed(p_event_id) THEN
        RAISE EXCEPTION 'Les inscriptions sont verrouillées: la date limite pour retirer un participant de cet événement est passée. Le montant dû reste exigible. Contactez un organisateur pour toute exception.';
    END IF;

    UPDATE public.user_parties
    SET logistics = COALESCE(p_party->'logistics', logistics),
        transport = COALESCE(p_party->'transport', transport),
        music_requests = CASE WHEN p_party ? 'music_requests' THEN p_party->>'music_requests' ELSE music_requests END,
        message_to_organizers = CASE WHEN p_party ? 'message_to_organizers' THEN p_party->>'message_to_organizers' ELSE message_to_organizers END,
        status = 'registered'
    WHERE id = v_party.id
    RETURNING * INTO v_party;

    PERFORM set_config('bedaine.saving_party', '', true);
    PERFORM set_config('bedaine.attendees_before', '', true);

    RETURN v_party;
END;
$$;

REVOKE ALL ON FUNCTION public.save_registration(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_registration(uuid, jsonb, jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Drop the JSON and what was derived from it.

DROP TRIGGER update_counts ON public.user_parties;
DROP FUNCTION public.update_attendee_counts();

-- The admin's member history dialog reads this view; it never used attendees or counts.
DROP VIEW public.user_event_history;

-- One-step deploy, accepted in #126: a tab on the previous frontend errors on save until reloaded.
-- squawk-ignore ban-drop-column
ALTER TABLE public.user_parties DROP COLUMN attendees;
-- squawk-ignore ban-drop-column
ALTER TABLE public.user_parties DROP COLUMN counts;

-- logistics keeps only party-wide answers (volunteering). sleeping was a copy of the first
-- attendee's choice and food_requests a join of everyone's dietary needs.
-- A data fix, not an edit: without triggers, so no audit row, edit count or recomputation.
ALTER TABLE public.user_parties DISABLE TRIGGER USER;
UPDATE public.user_parties SET logistics = logistics - 'sleeping' - 'food_requests';
ALTER TABLE public.user_parties ENABLE TRIGGER USER;
ALTER TABLE public.user_parties ALTER COLUMN logistics SET DEFAULT '{"volunteering": []}'::jsonb;

CREATE VIEW public.user_event_history WITH (security_invoker = true) AS
SELECT p.id AS user_id,
       p.email,
       p.full_name,
       up.id AS party_id,
       e.id AS event_id,
       e.theme AS event_theme,
       e.reg_start_date,
       up.status AS registration_status,
       up.calculated_amount_owed,
       up.payment_status,
       up.created_at AS registration_date,
       up.is_waitlisted
FROM public.profiles p
JOIN public.user_parties up ON p.id = up.user_id
JOIN public.events e ON up.event_id = e.id;

REVOKE ALL ON TABLE public.user_event_history FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.user_event_history TO authenticated;
