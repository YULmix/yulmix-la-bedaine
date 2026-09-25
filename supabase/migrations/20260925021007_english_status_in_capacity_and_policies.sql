-- Fixes #49: production's migrate_status_payment_status_to_english.sql backfilled
-- user_parties.status/payment_status data and the CHECK constraints to English values,
-- but left enforce_capacity_and_waitlist(), the "update own registrations" and
-- "delete own registrations" policies, and the column defaults comparing against the
-- old French values ('Enregistré'/'En attente'/'Impayé'). No row can match those any
-- more, so capacity/waitlisting was effectively disabled and members could not edit
-- their own registrations (RLS silently rejected the upsert). This carries forward the
-- relevant parts of supabase/legacy/migrate_status_payment_status_to_english.sql
-- (function, both policies, both defaults) without touching data already backfilled
-- or the registration_summary_view, which fix_views_security.sql intentionally dropped.

ALTER TABLE public.user_parties ALTER COLUMN status SET DEFAULT 'registered';
ALTER TABLE public.user_parties ALTER COLUMN payment_status SET DEFAULT 'unpaid';

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
