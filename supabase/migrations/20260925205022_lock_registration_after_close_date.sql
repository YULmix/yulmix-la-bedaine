-- Fixes #38: x_reg_close_weeks was displayed (EventDetailsView.jsx) but never enforced anywhere.
-- Per the issue's clarified scope (comment from @Dekayd), the close date does NOT block new
-- registrations or edits that add participants. What it must block, once the date has passed:
--   - a member deleting their own registration (a user_parties row)
--   - a member removing a participant from an existing registration (shrinking attendees)
-- In both cases the amount already owed stays fixed and is not reimbursed; admins are unaffected
-- and can still delete/edit any registration at any time for exception-handling.
--
-- Computing that date requires knowing when the event itself starts, which the schema could not
-- express at all: events only had reg_start_date (when registration opens) and duration_days.
-- This adds event_start_date and uses it together with x_reg_close_weeks to compute the close date.

ALTER TABLE public.events ADD COLUMN "event_start_date" date;

COMMENT ON COLUMN public.events."event_start_date" IS
  'The day the event itself starts, distinct from reg_start_date (when registration opens). Combined with x_reg_close_weeks to compute the registration close date. Nullable: enforcement is skipped for events where it is not set.';

CREATE OR REPLACE FUNCTION public.enforce_registration_lock_after_close_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_row public.user_parties;
    v_event_start_date DATE;
    v_close_weeks INT;
    v_close_date DATE;
BEGIN
    v_old_row := OLD;

    IF public.is_admin() THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    SELECT "event_start_date", x_reg_close_weeks
    INTO v_event_start_date, v_close_weeks
    FROM public.events
    WHERE id = v_old_row.event_id;

    -- Can't compute a close date without both inputs: nothing to enforce.
    IF v_event_start_date IS NULL OR v_close_weeks IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    v_close_date := v_event_start_date - (v_close_weeks * 7);

    IF CURRENT_DATE <= v_close_date THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Les inscriptions sont verrouillées: la date limite de désinscription pour cet événement est passée. Le montant dû reste exigible. Contactez un organisateur pour toute exception.';
    END IF;

    IF jsonb_array_length(NEW.attendees) < jsonb_array_length(v_old_row.attendees) THEN
        RAISE EXCEPTION 'Les inscriptions sont verrouillées: la date limite pour retirer un participant de cet événement est passée. Le montant dû reste exigible. Contactez un organisateur pour toute exception.';
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_registration_lock_after_close_date() OWNER TO "postgres";

CREATE TRIGGER "trg_enforce_registration_lock_after_close_date"
BEFORE UPDATE OR DELETE ON public.user_parties
FOR EACH ROW
EXECUTE FUNCTION public.enforce_registration_lock_after_close_date();
