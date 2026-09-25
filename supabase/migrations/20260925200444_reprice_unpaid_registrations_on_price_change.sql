-- Fixes #32: enforce_calculated_amount_owed() (added for #30, grandfathered for #31) only
-- recomputes calculated_amount_owed when a user_parties row itself is inserted or updated. When
-- an organiser changes events.selling_price_whole_event — the normal workflow, since intentions
-- are collected long before the final price is set — every existing registration keeps its stale
-- amount until the member happens to resave their own row.
--
-- Fix: an AFTER UPDATE trigger on events, firing only when selling_price_whole_event actually
-- changes, that touches every unpaid user_parties row for that event. The touch itself does
-- nothing (SET attendees = attendees) — it exists purely to re-fire the existing
-- trg_enforce_calculated_amount_owed BEFORE UPDATE trigger on each row, which reuses
-- calculate_party_amount_owed() against the now-updated price. Paid rows are left alone, exactly
-- as enforce_calculated_amount_owed() itself already skips them (#31).

CREATE OR REPLACE FUNCTION public.reprice_unpaid_registrations_on_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.user_parties
    SET attendees = attendees
    WHERE event_id = NEW.id
      AND payment_status IS DISTINCT FROM 'paid';

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.reprice_unpaid_registrations_on_price_change() OWNER TO "postgres";

CREATE TRIGGER trg_reprice_unpaid_on_price_change
AFTER UPDATE OF selling_price_whole_event ON public.events
FOR EACH ROW
WHEN (NEW.selling_price_whole_event IS DISTINCT FROM OLD.selling_price_whole_event)
EXECUTE FUNCTION public.reprice_unpaid_registrations_on_price_change();
