-- Fixes #35: members can cancel their own registration ("Se désinscrire"), as a soft status change.
--
-- - Cancelling sets status = 'cancelled'; the row is never deleted (deletion is always soft).
--   The existing trigger promotes the waitlist when a party becomes cancelled (#37).
-- - A member can register again after cancelling. UNIQUE (user_id, event_id) means that reuses
--   the cancelled row: the app's upsert moves it back to 'registered'.
-- - After the registration close date (event_start_date - x_reg_close_weeks weeks, #38), a member
--   can no longer cancel: the amount owed stays owed. Admins are exempt, as for every lock.
-- - Members lose hard DELETE on user_parties. Admins keep it.

-- ---------------------------------------------------------------------------------------------
-- UPDATE: a member may act on their own active or cancelled row and leave it active or cancelled.
-- Before, both sides only allowed 'registered'/'pending', so a member could neither cancel nor
-- re-register over a cancelled row.

DROP POLICY IF EXISTS "User Parties: User can update own registrations" ON public.user_parties;
CREATE POLICY "User Parties: User can update own registrations"
ON public.user_parties FOR UPDATE
USING ((auth.uid() = user_id AND status IN ('registered', 'pending', 'cancelled')) OR public.is_admin())
WITH CHECK ((auth.uid() = user_id AND status IN ('registered', 'pending', 'cancelled')) OR public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- DELETE: admins only.

DROP POLICY IF EXISTS "User Parties: User can delete own registrations" ON public.user_parties;
CREATE POLICY "User Parties: Admins can delete registrations"
ON public.user_parties FOR DELETE
USING (public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- The close-date lock (#38), extended: after the close date a member can't cancel either. Same
-- body as before otherwise, except that shrinking the attendee list of a *cancelled* row (while
-- registering again with a smaller group) isn't "removing a participant": that row owed nothing.

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

    IF NEW.status = 'cancelled' AND v_old_row.status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Les inscriptions sont verrouillées: la date limite de désinscription pour cet événement est passée. Le montant dû reste exigible. Contactez un organisateur pour toute exception.';
    END IF;

    IF v_old_row.status IS DISTINCT FROM 'cancelled'
       AND jsonb_array_length(NEW.attendees) < jsonb_array_length(v_old_row.attendees) THEN
        RAISE EXCEPTION 'Les inscriptions sont verrouillées: la date limite pour retirer un participant de cet événement est passée. Le montant dû reste exigible. Contactez un organisateur pour toute exception.';
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_registration_lock_after_close_date() OWNER TO "postgres";
