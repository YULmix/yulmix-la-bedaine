-- #247: raising an event's capacity must promote the waiting list, like a cancellation does.
--
-- The promotion loop used to live inside the cancel trigger function, keyed on the cancelled
-- party's event_id. It is extracted into private.promote_waitlisted_for_event(event_id), called
-- from the cancel trigger and from a new AFTER UPDATE OF max_attendees ON events trigger.
--
-- Source of the loop: public.promote_waitlisted_parties() in
-- 20260929003000_attendees_table.sql (latest definition on origin/main). Differences: the
-- advisory lock is taken BEFORE reading max_attendees, and capacity NULL or <= 0 (no limit)
-- now promotes every waitlisted party (organiser decision on #247) instead of returning.
-- Lowering capacity demotes nobody. Promotions are plain is_waitlisted updates, so the
-- existing email trigger (trg_request_party_email_on_update) still sends the « promotion » mail.

CREATE OR REPLACE FUNCTION private.promote_waitlisted_for_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_max_attendees INT;
    v_remaining_capacity INT;
    v_unlimited BOOLEAN;
    v_party RECORD;
BEGIN
    -- Same per-event lock as enforce_capacity_and_waitlist, so a registration cannot
    -- slip in between the headcount and the promotions.
    PERFORM pg_advisory_xact_lock(hashtext(p_event_id::text));

    SELECT max_attendees INTO v_max_attendees
    FROM public.events
    WHERE id = p_event_id;

    v_unlimited := v_max_attendees IS NULL OR v_max_attendees <= 0;

    IF NOT v_unlimited THEN
        v_remaining_capacity := v_max_attendees - private.event_headcount(p_event_id);
        IF v_remaining_capacity <= 0 THEN
            RETURN;
        END IF;
    END IF;

    FOR v_party IN
        SELECT up.id, private.party_size(up.id) AS size
        FROM public.user_parties up
        WHERE up.event_id = p_event_id
          AND up.is_waitlisted = TRUE
          AND up.status IN ('registered', 'pending')
        ORDER BY up.created_at ASC
    LOOP
        IF NOT v_unlimited THEN
            -- All-or-nothing per party: the first one that does not fit stops the loop.
            EXIT WHEN v_party.size > v_remaining_capacity;
        END IF;

        UPDATE public.user_parties
        SET is_waitlisted = FALSE
        WHERE id = v_party.id;

        IF NOT v_unlimited THEN
            v_remaining_capacity := v_remaining_capacity - v_party.size;
            EXIT WHEN v_remaining_capacity <= 0;
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION private.promote_waitlisted_for_event(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.promote_waitlisted_parties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.promote_waitlisted_for_event(NEW.event_id);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_waitlisted_parties() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.promote_waitlisted_on_capacity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.promote_waitlisted_for_event(NEW.id);
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.promote_waitlisted_on_capacity_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.promote_waitlisted_on_capacity_change() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_promote_waitlisted_on_capacity_change
AFTER UPDATE OF max_attendees ON public.events
FOR EACH ROW
WHEN (NEW.max_attendees IS DISTINCT FROM OLD.max_attendees)
EXECUTE FUNCTION public.promote_waitlisted_on_capacity_change();

-- A registration must read the capacity AFTER the per-event lock, or it can compute
-- is_waitlisted from a capacity that a concurrent raise has just replaced (and nobody would
-- promote it later). The lock is taken first on every path, including the unlimited one.
-- Source: public.enforce_capacity_and_waitlist() in 20260929003000_attendees_table.sql (latest
-- definition on origin/main); only the order of the lock and the SELECT changed.
CREATE OR REPLACE FUNCTION public.enforce_capacity_and_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_max_attendees INT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.event_id::text));

    SELECT max_attendees INTO v_max_attendees
    FROM public.events
    WHERE id = NEW.event_id;

    IF v_max_attendees IS NULL OR v_max_attendees <= 0 THEN
        NEW.is_waitlisted := FALSE;
        RETURN NEW;
    END IF;

    NEW.is_waitlisted := private.event_headcount(NEW.event_id, NEW.id) + private.party_size(NEW.id) > v_max_attendees;

    RETURN NEW;
END;
$$;
