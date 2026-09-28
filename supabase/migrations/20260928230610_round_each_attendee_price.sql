-- #120: round each attendee's price up to the dollar, and make a party owe the sum of those
-- rounded prices. It used to be ceil(Σ shares × base price), so the per-attendee lines shown in
-- the registration form didn't add up to the total (two adults on the main event at 200 $ were
-- 108 + 108 on the lines but 215 $ owed; they now owe 216 $).
--
-- Only the rounding moves inside the loop; the shares are unchanged. enforce_calculated_amount_owed
-- calls this, so stored amounts follow on the next insert or update. Existing rows are not
-- repriced: the app hasn't been released yet, and a paid party's amount stays frozen (#31).

-- Must stay in step with src/lib/pricingEngine.js (attendeePrice / simulateEventPricing).
CREATE OR REPLACE FUNCTION public.calculate_party_amount_owed(
  p_attendees JSONB,
  p_selling_price_whole_event NUMERIC,
  p_ratio_main_whole NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_total NUMERIC := 0;
    v_attendee JSONB;
    v_type TEXT;
    v_participation TEXT;
    v_share NUMERIC;
BEGIN
    IF p_selling_price_whole_event IS NULL OR p_selling_price_whole_event <= 0 THEN
        RETURN 0;
    END IF;

    FOR v_attendee IN SELECT * FROM jsonb_array_elements(COALESCE(p_attendees, '[]'::jsonb))
    LOOP
        v_type := v_attendee->>'type';
        v_participation := COALESCE(v_attendee->>'participation', 'Whole');

        -- Newbies pay the main-event price whatever tier they picked.
        IF COALESCE((v_attendee->>'is_new_member')::boolean, FALSE) THEN
            v_participation := 'Main';
        END IF;

        v_share := CASE
            WHEN v_type IN ('Adult', 'Teenager') THEN
                (CASE WHEN v_participation = 'Whole' THEN 1 ELSE p_ratio_main_whole END)
                * (CASE WHEN v_type = 'Teenager' THEN 0.5 ELSE 1 END) -- teens pay half
            ELSE 0 -- Kids: free.
        END;

        -- Each attendee rounded up to the dollar, matching attendeePrice() in pricingEngine.js.
        v_total := v_total + CEIL(v_share * p_selling_price_whole_event);
    END LOOP;

    RETURN v_total;
END;
$$;
