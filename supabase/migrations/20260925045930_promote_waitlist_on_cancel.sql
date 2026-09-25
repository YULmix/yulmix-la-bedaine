-- Fixes #37: cancelling a party never cleared is_waitlisted for anyone else, so a freed
-- spot just sat empty until an admin manually edited another party's row. This adds a
-- trigger that promotes the oldest still-waitlisted party (or parties, if the cancellation
-- frees enough capacity for more than one) for the same event whenever a party's status
-- transitions to 'cancelled'.
--
-- SECURITY DEFINER is required: the promotion UPDATE touches other members' rows, which the
-- "User Parties: User can update own registrations" RLS policy would otherwise block for a
-- non-admin member cancelling their own party.

CREATE OR REPLACE FUNCTION public.promote_waitlisted_parties()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_max_attendees INT;
    v_current_registered INT;
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

    SELECT COALESCE(SUM(jsonb_array_length(up.attendees)), 0) INTO v_current_registered
    FROM public.user_parties up
    WHERE up.event_id = NEW.event_id
      AND up.is_waitlisted = FALSE
      AND up.status IN ('registered', 'pending');

    v_remaining_capacity := v_max_attendees - v_current_registered;

    IF v_remaining_capacity <= 0 THEN
        RETURN NEW;
    END IF;

    FOR v_party IN
        SELECT id, attendees
        FROM public.user_parties
        WHERE event_id = NEW.event_id
          AND is_waitlisted = TRUE
          AND status IN ('registered', 'pending')
        ORDER BY created_at ASC
    LOOP
        EXIT WHEN jsonb_array_length(v_party.attendees) > v_remaining_capacity;

        UPDATE public.user_parties
        SET is_waitlisted = FALSE
        WHERE id = v_party.id;

        v_remaining_capacity := v_remaining_capacity - jsonb_array_length(v_party.attendees);

        EXIT WHEN v_remaining_capacity <= 0;
    END LOOP;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.promote_waitlisted_parties() OWNER TO postgres;

GRANT ALL ON FUNCTION public.promote_waitlisted_parties() TO authenticated;

CREATE OR REPLACE TRIGGER trg_promote_waitlisted_on_cancel
AFTER UPDATE OF status ON public.user_parties
FOR EACH ROW
WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
EXECUTE FUNCTION public.promote_waitlisted_parties();
