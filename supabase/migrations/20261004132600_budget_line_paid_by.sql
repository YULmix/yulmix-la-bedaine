-- #236: an expense line (event_budgets.lines[]) may name who paid it: `paid_by_attendee_id`, an
-- attendee id. Absent or null = nobody (the common fund). When present it must be an attendee of a
-- party of the budget's own event. A removed (soft-deleted, #237) attendee still counts, so an old
-- expense stays valid after its payer leaves the party. It never changes total_cost.
--
-- The check runs in a SECURITY DEFINER helper: under the restrictive "removed ones are hidden"
-- policy, the admin saving the budget can't see a removed attendee through RLS.
--
-- enforce_event_budget body copied from its latest definition,
-- 20260930200216_database_errors_are_codes.sql; the only change is the paid_by check.
-- New error code: event_budget_payer_invalid {line}.

CREATE FUNCTION private.attendee_in_event(p_attendee_id uuid, p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.attendees a
        JOIN public.user_parties p ON p.id = a.party_id
        WHERE a.id = p_attendee_id AND p.event_id = p_event_id
    );
$$;

REVOKE ALL ON FUNCTION private.attendee_in_event(uuid, uuid) FROM PUBLIC;
-- Called by the budget trigger (SECURITY INVOKER) as whoever saves the budget.
GRANT EXECUTE ON FUNCTION private.attendee_in_event(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_event_budget()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_line JSONB;
    v_total NUMERIC := 0;
BEGIN
    IF jsonb_typeof(NEW.lines) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION USING MESSAGE = 'event_budget_lines_invalid', ERRCODE = 'check_violation';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(NEW.lines)
    LOOP
        IF jsonb_typeof(v_line) IS DISTINCT FROM 'object'
           OR NOT (v_line->>'category' = ANY (ARRAY['Chalet', 'Food', 'Music', 'Tech', 'Accessories', 'Other']))
           OR jsonb_typeof(v_line->'amount') IS DISTINCT FROM 'number'
           OR (v_line->>'amount')::numeric < 0
           OR (v_line ? 'description' AND jsonb_typeof(v_line->'description') IS DISTINCT FROM 'string') THEN
            RAISE EXCEPTION USING MESSAGE = 'event_budget_line_invalid', DETAIL = json_build_object('line', v_line)::text,
                ERRCODE = 'check_violation';
        END IF;

        -- The payer: absent or null, else an attendee (removed or not) of this event.
        IF jsonb_typeof(v_line->'paid_by_attendee_id') IS DISTINCT FROM 'null'
           AND v_line ? 'paid_by_attendee_id'
           AND (
               jsonb_typeof(v_line->'paid_by_attendee_id') IS DISTINCT FROM 'string'
               OR (v_line->>'paid_by_attendee_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               OR NOT private.attendee_in_event((v_line->>'paid_by_attendee_id')::uuid, NEW.event_id)
           ) THEN
            RAISE EXCEPTION USING MESSAGE = 'event_budget_payer_invalid', DETAIL = json_build_object('line', v_line)::text,
                ERRCODE = 'check_violation';
        END IF;

        v_total := v_total + (v_line->>'amount')::numeric;
    END LOOP;

    NEW.total_cost := v_total;
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$
;
