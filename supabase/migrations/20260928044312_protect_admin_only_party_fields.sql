-- Fixes #94: the user_parties INSERT/UPDATE policies only check whose row it is, so a member could
-- write the admin-only fields of their own registration straight through the API: mark it paid,
-- overwrite the organisers' private admin_notes, or give an attendee a bed. The payment and
-- accommodation emails (AFTER triggers) then went out for things no organiser did.
--
-- Fix: a BEFORE INSERT OR UPDATE trigger that ignores what a member sends for those fields, the
-- same "ignore the client value" pattern as calculated_amount_owed and app_feedback.is_resolved.
-- It doesn't raise: the member form sends payment_status and the beds back on every save.
--
--   * INSERT: 'unpaid', no admin_notes, no beds.
--   * UPDATE: the stored payment_status and admin_notes. A paid party stays paid through a member's
--     own edit (#31), including when they re-register over their own cancelled row (#35).
--   * Beds are carried over by attendee name, not position: attendees have no stable id, and a
--     member can remove or reorder them. Each stored attendee is matched once, in order, so
--     duplicate names work; a new or renamed attendee ends up without a bed.
--
-- Only end users are restricted (JWT role authenticated/anon, not an admin). service_role (Edge
-- Functions) and direct connections (migrations, postgres) have no such JWT role and pass through.
-- An upsert runs the INSERT branch and then, on conflict, the UPDATE branch, which restores the
-- stored values.

CREATE OR REPLACE FUNCTION public.protect_admin_only_party_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_attendee jsonb;
    v_attendees jsonb := '[]'::jsonb;
    v_bed text;
    v_match_ord bigint;
    v_match_bed text;
    v_used bigint[] := '{}';
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
        IF NEW.attendees IS NOT DISTINCT FROM OLD.attendees THEN
            RETURN NEW;
        END IF;
    END IF;

    IF jsonb_typeof(NEW.attendees) IS DISTINCT FROM 'array' THEN
        RETURN NEW;
    END IF;

    FOR v_attendee IN SELECT value FROM jsonb_array_elements(NEW.attendees) LOOP
        v_bed := '';
        IF TG_OP = 'UPDATE' AND jsonb_typeof(OLD.attendees) = 'array' THEN
            SELECT o.ord, COALESCE(o.value->>'assigned_bed', '')
            INTO v_match_ord, v_match_bed
            FROM jsonb_array_elements(OLD.attendees) WITH ORDINALITY AS o(value, ord)
            WHERE btrim(o.value->>'name') = btrim(v_attendee->>'name')
              AND NOT (o.ord = ANY (v_used))
            ORDER BY o.ord
            LIMIT 1;
            IF FOUND THEN
                v_used := v_used || v_match_ord;
                v_bed := v_match_bed;
            END IF;
        END IF;

        -- Only touch the key when it differs, so an unchanged attendee stays byte-identical.
        IF jsonb_typeof(v_attendee) = 'object'
           AND COALESCE(v_attendee->>'assigned_bed', '') IS DISTINCT FROM v_bed THEN
            v_attendee := jsonb_set(v_attendee, '{assigned_bed}', to_jsonb(v_bed));
        END IF;
        v_attendees := v_attendees || jsonb_build_array(v_attendee);
    END LOOP;

    NEW.attendees := v_attendees;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_admin_only_party_fields() OWNER TO "postgres";

CREATE TRIGGER trg_protect_admin_only_party_fields
BEFORE INSERT OR UPDATE ON public.user_parties
FOR EACH ROW
EXECUTE FUNCTION public.protect_admin_only_party_fields();
