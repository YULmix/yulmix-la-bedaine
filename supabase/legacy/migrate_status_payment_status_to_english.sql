-- Migrate user_parties.status and user_parties.payment_status from French to English
-- enum values, matching events.status ('DRAFT'|'ACTIVE'|'ARCHIVED'). Supersedes ADR 0006
-- ("Payment status is stored in French"), which is now resolved rather than merely
-- regretted. Apply this against the live database (schema.sql and the DB have drifted;
-- see docs/09-state-of-the-code.md) — schema.sql itself already reflects the new values
-- for fresh installs.
--
-- Mapping:
--   status:         'Enregistré' -> 'registered', 'En attente' -> 'pending', 'Annulé' -> 'cancelled'
--   payment_status: 'Payé' -> 'paid', 'Impayé' -> 'unpaid'

-- 1. Drop the constraints/defaults that reference the old French values before touching data.
ALTER TABLE public.user_parties ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.user_parties ALTER COLUMN payment_status DROP DEFAULT;
ALTER TABLE public.user_parties DROP CONSTRAINT IF EXISTS user_parties_payment_status_check;

-- 2. Backfill existing rows.
UPDATE public.user_parties SET status = 'registered' WHERE status = 'Enregistré';
UPDATE public.user_parties SET status = 'pending' WHERE status = 'En attente';
UPDATE public.user_parties SET status = 'cancelled' WHERE status = 'Annulé';
UPDATE public.user_parties SET payment_status = 'paid' WHERE payment_status = 'Payé';
UPDATE public.user_parties SET payment_status = 'unpaid' WHERE payment_status = 'Impayé';

-- 3. Re-add defaults and constraints with the new English values.
ALTER TABLE public.user_parties ALTER COLUMN status SET DEFAULT 'registered';
ALTER TABLE public.user_parties ALTER COLUMN payment_status SET DEFAULT 'unpaid';
ALTER TABLE public.user_parties ADD CONSTRAINT user_parties_status_check
  CHECK (status IN ('registered', 'pending', 'cancelled'));
ALTER TABLE public.user_parties ADD CONSTRAINT user_parties_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid'));

-- 4. Recreate the view, policies and trigger function that compared against the old values.
CREATE OR REPLACE VIEW public.registration_summary_view AS
SELECT
    id,
    event_id,
    status,
    payment_status,
    calculated_amount_owed,
    is_waitlisted,
    logistics,
    transport,
    music_requests,
    message_to_organizers,
    last_edited_at,
    edit_count,
    attendees
FROM public.user_parties
WHERE status IN ('registered', 'pending');

DROP POLICY IF EXISTS "User Parties: User can update own registrations" ON public.user_parties;
CREATE POLICY "User Parties: User can update own registrations"
ON public.user_parties FOR UPDATE
USING ((auth.uid() = user_id AND status IN ('registered', 'pending')) OR public.is_admin())
WITH CHECK ((auth.uid() = user_id AND status IN ('registered', 'pending')) OR public.is_admin());

DROP POLICY IF EXISTS "User Parties: User can delete own registrations" ON public.user_parties;
CREATE POLICY "User Parties: User can delete own registrations"
ON public.user_parties FOR DELETE
USING ((auth.uid() = user_id AND status IN ('registered', 'pending')) OR public.is_admin());

CREATE OR REPLACE FUNCTION public.enforce_capacity_and_waitlist()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_event_id UUID;
    v_max_attendees INT;
    v_current_registered INT;
    v_is_waitlisted BOOLEAN;
BEGIN
    v_event_id := NEW.event_id;

    SELECT max_attendees INTO v_max_attendees
    FROM public.events
    WHERE id = v_event_id;

    IF v_max_attendees IS NULL OR v_max_attendees <= 0 THEN
        NEW.is_waitlisted := FALSE;
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_event_id::text));

    SELECT COALESCE(SUM(jsonb_array_length(up.attendees)), 0) INTO v_current_registered
    FROM public.user_parties up
    WHERE up.event_id = v_event_id
      AND up.is_waitlisted = FALSE
      AND up.status IN ('registered', 'pending')
      AND up.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID);

    v_current_registered := v_current_registered + jsonb_array_length(NEW.attendees);

    v_is_waitlisted := v_current_registered > v_max_attendees;

    NEW.is_waitlisted := v_is_waitlisted;

    RETURN NEW;
END;
$$;
