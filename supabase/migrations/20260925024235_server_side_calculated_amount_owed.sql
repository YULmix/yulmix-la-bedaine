-- Fixes #30: calculated_amount_owed was written as a plain client-supplied value
-- (RegistrationForm.jsx upserts registrationData.calculated_amount_owed = estimatedBalance)
-- and the member UPDATE RLS policy lets a member write their own row, with no trigger
-- recomputing it — anyone with devtools or a REST client + their own JWT could set their
-- balance to zero.
--
-- This recreates the pricing rules from src/lib/pricingEngine.js (calculateBasePoints,
-- getFinalPoints, simulateEventPricing's per-party cost path) in SQL and enforces them in
-- a BEFORE INSERT OR UPDATE trigger, ignoring whatever the client sent. pricingEngine.js
-- remains the *display* estimate so the registration form stays live/interactive; the two
-- must agree (see src/lib/pricingEngine.test.js and the parity cases added there).
--
-- Deliberately NOT handled here (separate, already-filed issues that depend on this one):
--   - Grandfathering paid parties' historical amount (#31) — this always recomputes fresh.
--   - Repricing existing unpaid registrations when selling_price_whole_event changes (#32)
--     — this only fires on INSERT/UPDATE of a user_parties row, not retroactively.

CREATE OR REPLACE FUNCTION public.calculate_party_amount_owed(
  p_attendees JSONB,
  p_selling_price_whole_event NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_price_per_point NUMERIC;
    v_total NUMERIC := 0;
    v_attendee JSONB;
    v_type TEXT;
    v_participation TEXT;
    v_is_new_member BOOLEAN;
    v_points NUMERIC;
BEGIN
    IF p_selling_price_whole_event IS NULL OR p_selling_price_whole_event <= 0 THEN
        v_price_per_point := 0;
    ELSE
        -- Adult Whole Event (2.0 pts) pays exactly selling_price_whole_event.
        v_price_per_point := p_selling_price_whole_event / 2.0;
    END IF;

    FOR v_attendee IN SELECT * FROM jsonb_array_elements(COALESCE(p_attendees, '[]'::jsonb))
    LOOP
        v_type := v_attendee->>'type';
        v_participation := COALESCE(v_attendee->>'participation', 'Whole');
        v_is_new_member := COALESCE((v_attendee->>'is_new_member')::boolean, FALSE);

        -- Newbies always pay the Main Event rate regardless of tier (tier ignored).
        IF v_is_new_member THEN
            v_participation := 'Main';
        END IF;

        v_points := CASE
            WHEN v_type = 'Adult' THEN
                CASE WHEN v_participation = 'Whole' THEN 2.0 ELSE 1.075 END
            WHEN v_type = 'Teenager' THEN
                CASE WHEN v_participation = 'Whole' THEN 1.0 ELSE 0.5375 END
            ELSE 0.0 -- Kids / After-Party-only kids: free.
        END;

        v_total := v_total + (v_points * v_price_per_point);
    END LOOP;

    -- Round up to the nearest dollar, matching pricingEngine.js's Math.ceil(partyTotal).
    RETURN CEIL(v_total);
END;
$$;

ALTER FUNCTION public.calculate_party_amount_owed(JSONB, NUMERIC) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION public.enforce_calculated_amount_owed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_selling_price NUMERIC;
BEGIN
    SELECT selling_price_whole_event INTO v_selling_price
    FROM public.events
    WHERE id = NEW.event_id;

    NEW.calculated_amount_owed := public.calculate_party_amount_owed(NEW.attendees, v_selling_price);

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_calculated_amount_owed() OWNER TO "postgres";

CREATE TRIGGER trg_enforce_calculated_amount_owed
BEFORE INSERT OR UPDATE ON public.user_parties
FOR EACH ROW EXECUTE FUNCTION public.enforce_calculated_amount_owed();
