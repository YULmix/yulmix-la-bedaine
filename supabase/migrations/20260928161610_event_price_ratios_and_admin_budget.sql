-- #109: a per-event main-event ratio, and the budget moved to an admin-only table.
--
-- 1. Price ratio. The point weights were hardcoded here and in src/lib/pricingEngine.js. Every
--    price is now a share of the adult whole-weekend price (selling_price_whole_event):
--      adult main  = ratio_main_whole × adult whole   (per event)
--      teen        = 50 % of the adult price of the same tier (fixed)
--      newbie      = the main price of their age, whatever tier they picked
--      kids        = free
--    The default (0.5375) gives exactly the old weights (2.0, 1.075, 1.0, 0.5375 points on a
--    price per point of selling_price / 2), so no amount changes when this is applied.
--    Changing the ratio reprices unpaid registrations the same way a price change does (#32).
--    The budget never affects any amount: it is only what the admin simulator works from.
--
-- 2. Budget. cost_breakdown, total_cost, expense_category and estimated_individual_cost_whole_event
--    were columns on events, which anyone (even signed out) can read for ACTIVE/ARCHIVED events.
--    They move to public.event_budgets, readable and writable by admins only. Each line has a
--    category, a description and an amount; total_cost is always the sum of the lines, kept by a
--    trigger. The event-wide expense_category (one category for a whole list of costs) and the
--    hand-typed estimated cost per person (replaced by the break-even price the admin computes
--    from the budget) are dropped.

-- 1. Price ratios -------------------------------------------------------------------------------

ALTER TABLE public.events
  ADD COLUMN ratio_main_whole NUMERIC(5, 4) NOT NULL DEFAULT 0.5375,
  ADD CONSTRAINT events_ratio_main_whole_range CHECK (ratio_main_whole > 0 AND ratio_main_whole <= 1);

COMMENT ON COLUMN public.events.ratio_main_whole IS
  'Main-event price as a share of the whole-weekend price (#109). Newbies pay the main price.';

-- Must stay in step with src/lib/pricingEngine.js (getPriceShare / simulateEventPricing).
CREATE FUNCTION public.calculate_party_amount_owed(
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

        v_total := v_total + v_share * p_selling_price_whole_event;
    END LOOP;

    -- Round up to the nearest dollar, matching pricingEngine.js.
    RETURN CEIL(v_total);
END;
$$;

ALTER FUNCTION public.calculate_party_amount_owed(JSONB, NUMERIC, NUMERIC) OWNER TO "postgres";

-- Same as #31's version, reading the event's ratio too.
CREATE OR REPLACE FUNCTION public.enforce_calculated_amount_owed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_event public.events%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.payment_status = 'paid' THEN
        NEW.calculated_amount_owed := OLD.calculated_amount_owed;
        RETURN NEW;
    END IF;

    SELECT * INTO v_event FROM public.events WHERE id = NEW.event_id;

    NEW.calculated_amount_owed := public.calculate_party_amount_owed(
        NEW.attendees,
        v_event.selling_price_whole_event,
        COALESCE(v_event.ratio_main_whole, 0.5375)
    );

    RETURN NEW;
END;
$$;

DROP FUNCTION public.calculate_party_amount_owed(JSONB, NUMERIC);

-- #32's repricing, now also on a change of the ratio. The function body is unchanged.
DROP TRIGGER trg_reprice_unpaid_on_price_change ON public.events;

CREATE TRIGGER trg_reprice_unpaid_on_price_change
AFTER UPDATE OF selling_price_whole_event, ratio_main_whole ON public.events
FOR EACH ROW
WHEN (
    NEW.selling_price_whole_event IS DISTINCT FROM OLD.selling_price_whole_event
    OR NEW.ratio_main_whole IS DISTINCT FROM OLD.ratio_main_whole
)
EXECUTE FUNCTION public.reprice_unpaid_registrations_on_price_change();

-- 2. Budget -------------------------------------------------------------------------------------

CREATE TABLE public.event_budgets (
    event_id UUID PRIMARY KEY REFERENCES public.events (id),
    -- [{ "category": "Chalet", "description": "Location", "amount": 1200.00 }, …]
    lines JSONB NOT NULL DEFAULT '[]'::jsonb,
    contingency_pct NUMERIC(5, 2) NOT NULL DEFAULT 20 CHECK (contingency_pct >= 0 AND contingency_pct <= 100),
    -- Always the sum of lines[].amount, set by the trigger below; whatever the client sends is ignored.
    total_cost NUMERIC(10, 2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_budgets IS
  'Admin-only budget of an event (#109): categorized cost lines and the contingency used for the break-even price.';

-- Validates the lines and recomputes total_cost. Raises check_violation with an English message;
-- the admin UI maps the code, never shows the text (#102).
CREATE FUNCTION public.enforce_event_budget()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_line JSONB;
    v_total NUMERIC := 0;
BEGIN
    IF jsonb_typeof(NEW.lines) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'event_budgets.lines must be an array' USING ERRCODE = 'check_violation';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(NEW.lines)
    LOOP
        IF jsonb_typeof(v_line) IS DISTINCT FROM 'object'
           OR NOT (v_line->>'category' = ANY (ARRAY['Chalet', 'Food', 'Music', 'Tech', 'Accessories', 'Other']))
           OR jsonb_typeof(v_line->'amount') IS DISTINCT FROM 'number'
           OR (v_line->>'amount')::numeric < 0
           OR (v_line ? 'description' AND jsonb_typeof(v_line->'description') IS DISTINCT FROM 'string') THEN
            RAISE EXCEPTION 'invalid budget line: %', v_line USING ERRCODE = 'check_violation';
        END IF;
        v_total := v_total + (v_line->>'amount')::numeric;
    END LOOP;

    NEW.total_cost := v_total;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_event_budget() OWNER TO "postgres";

CREATE TRIGGER trg_enforce_event_budget
BEFORE INSERT OR UPDATE ON public.event_budgets
FOR EACH ROW EXECUTE FUNCTION public.enforce_event_budget();

ALTER TABLE public.event_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event Budgets: Admin full access" ON public.event_budgets
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- No grant to anon at all; authenticated goes through the admin-only policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_budgets TO authenticated;

-- Carry the existing budgets over. A line's free-text category maps to a known category when it
-- names one (English or French, any case), to Other otherwise, and keeps its text as the
-- description. An event with a total_cost but no lines keeps it as a single Other line.
INSERT INTO public.event_budgets (event_id, lines)
SELECT
    e.id,
    CASE
        WHEN jsonb_typeof(e.cost_breakdown) = 'array' AND jsonb_array_length(e.cost_breakdown) > 0 THEN (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'category', CASE lower(btrim(COALESCE(line->>'category', '')))
                    WHEN 'chalet' THEN 'Chalet'
                    WHEN 'food' THEN 'Food'
                    WHEN 'nourriture' THEN 'Food'
                    WHEN 'bouffe' THEN 'Food'
                    WHEN 'music' THEN 'Music'
                    WHEN 'musique' THEN 'Music'
                    WHEN 'tech' THEN 'Tech'
                    WHEN 'technique' THEN 'Tech'
                    WHEN 'accessories' THEN 'Accessories'
                    WHEN 'accessoires' THEN 'Accessories'
                    ELSE 'Other'
                END,
                'description', COALESCE(line->>'category', ''),
                'amount', GREATEST(COALESCE(
                    CASE WHEN jsonb_typeof(line->'amount') = 'number' THEN (line->>'amount')::numeric END,
                    0), 0)
            ) ORDER BY ord), '[]'::jsonb)
            FROM jsonb_array_elements(e.cost_breakdown) WITH ORDINALITY AS t(line, ord)
            WHERE jsonb_typeof(line) = 'object'
        )
        WHEN COALESCE(e.total_cost, 0) > 0 THEN
            jsonb_build_array(jsonb_build_object('category', 'Other', 'description', '', 'amount', e.total_cost))
        ELSE '[]'::jsonb
    END
FROM public.events e
WHERE (jsonb_typeof(e.cost_breakdown) = 'array' AND jsonb_array_length(e.cost_breakdown) > 0)
   OR COALESCE(e.total_cost, 0) > 0;

-- The budget data now lives in event_budgets, and leaving it on events would keep it public.
-- Only the old admin event dialog writes these columns, so the one client this can break is an
-- admin saving that dialog during the deploy.
ALTER TABLE public.events DROP CONSTRAINT events_expense_category_check;
-- squawk-ignore ban-drop-column
ALTER TABLE public.events DROP COLUMN cost_breakdown;
-- squawk-ignore ban-drop-column
ALTER TABLE public.events DROP COLUMN total_cost;
-- squawk-ignore ban-drop-column
ALTER TABLE public.events DROP COLUMN expense_category;
-- squawk-ignore ban-drop-column
ALTER TABLE public.events DROP COLUMN estimated_individual_cost_whole_event;
