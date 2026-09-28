-- #117: a price change only affects registrations made afterwards. Reverses #32 / #109, which
-- repriced every unpaid registration when the base price or the main-event ratio changed.
--
-- Each registration locks the base price and the main-event ratio in force when it is made, and
-- every later recalculation of its calculated_amount_owed (a member adding someone, an admin edit,
-- a waitlist promotion) uses the locked values, never the event's current ones. The two are locked
-- together. Paid grandfathering (#31) is unchanged: a paid party's amount doesn't move at all.
--
-- The database owns both columns: what any client sends (member or admin) is ignored.
--
--   * INSERT: locked at the event's current values.
--   * UPDATE: the stored values, except that
--       - a member re-registering over their own cancelled row (#35) gets the current values:
--         cancelling ended the deal, the re-registration is a new one;
--       - a row that isn't locked yet (below) gets locked as soon as the event has a price.
--   * No price yet: an event's price defaults to 0, and intents are collected before organisers set
--     it. A row made while the price is 0 stays unlocked (both columns NULL) and owes 0. When the
--     event first gets a price, its unpaid unlocked rows are locked at it. That is the only case in
--     which a change to the event writes to user_parties.

ALTER TABLE public.user_parties
  ADD COLUMN locked_selling_price_whole_event NUMERIC(10, 2),
  ADD COLUMN locked_ratio_main_whole NUMERIC(5, 4);

COMMENT ON COLUMN public.user_parties.locked_selling_price_whole_event IS
  'Base price in force when the registration was made (#117), set by the database. NULL until the event has a price.';
COMMENT ON COLUMN public.user_parties.locked_ratio_main_whole IS
  'Main-event ratio in force when the registration was made (#117), set by the database with the locked price.';

-- Backfill at the event's current values. Unpaid amounts already reflect them (they were repriced
-- on every change), so no amount moves. The user triggers are off for the backfill: it is not an
-- edit (no edit_count, no history entry, no email), and the new trigger below would ignore it.
ALTER TABLE public.user_parties DISABLE TRIGGER USER;

UPDATE public.user_parties p
SET locked_selling_price_whole_event = e.selling_price_whole_event,
    locked_ratio_main_whole = COALESCE(e.ratio_main_whole, 0.5375)
FROM public.events e
WHERE e.id = p.event_id
  AND e.selling_price_whole_event > 0;

ALTER TABLE public.user_parties ENABLE TRIGGER USER;

-- #31's version, computing from the party's locked values rather than the event's current ones.
CREATE OR REPLACE FUNCTION public.enforce_calculated_amount_owed()
RETURNS TRIGGER
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

    NEW.calculated_amount_owed := public.calculate_party_amount_owed(
        NEW.attendees,
        COALESCE(NEW.locked_selling_price_whole_event, 0),
        COALESCE(NEW.locked_ratio_main_whole, 0.5375)
    );

    RETURN NEW;
END;
$$;

-- Replaces the #32 / #109 repricing. Only rows that aren't locked yet are touched, and only when the
-- event gets a price: the update re-fires trg_enforce_calculated_amount_owed, which locks them. It
-- sets a column no other BEFORE trigger listens to (the capacity check fires on attendees/status).
DROP TRIGGER trg_reprice_unpaid_on_price_change ON public.events;
DROP FUNCTION public.reprice_unpaid_registrations_on_price_change();

CREATE FUNCTION public.lock_unpriced_registrations_on_first_price()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.user_parties
    SET locked_selling_price_whole_event = NULL
    WHERE event_id = NEW.id
      AND locked_selling_price_whole_event IS NULL
      AND payment_status IS DISTINCT FROM 'paid';

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.lock_unpriced_registrations_on_first_price() OWNER TO "postgres";

CREATE TRIGGER trg_lock_unpriced_registrations_on_first_price
AFTER UPDATE OF selling_price_whole_event ON public.events
FOR EACH ROW
WHEN (COALESCE(OLD.selling_price_whole_event, 0) <= 0 AND NEW.selling_price_whole_event > 0)
EXECUTE FUNCTION public.lock_unpriced_registrations_on_first_price();
