-- Fixes #31: enforce_calculated_amount_owed() (added for #30) recomputes calculated_amount_owed
-- from current pricing on every INSERT or UPDATE, with no exception for a party that has already
-- paid. A member editing their registration after paying (or a price change) silently overwrites
-- the amount they actually paid.
--
-- Fix: on UPDATE, if the row's own persisted payment_status (OLD, never NEW/client-supplied) is
-- 'paid', keep the existing calculated_amount_owed instead of recomputing. A brand-new INSERT has
-- no OLD row and always computes fresh, regardless of any paid-like value on the incoming data.
--
-- Deliberately NOT handled here (separate, already-filed issue): retroactively repricing existing
-- *unpaid* registrations when selling_price_whole_event changes (#32).

CREATE OR REPLACE FUNCTION public.enforce_calculated_amount_owed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_selling_price NUMERIC;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.payment_status = 'paid' THEN
        NEW.calculated_amount_owed := OLD.calculated_amount_owed;
        RETURN NEW;
    END IF;

    SELECT selling_price_whole_event INTO v_selling_price
    FROM public.events
    WHERE id = NEW.event_id;

    NEW.calculated_amount_owed := public.calculate_party_amount_owed(NEW.attendees, v_selling_price);

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_calculated_amount_owed() OWNER TO "postgres";
