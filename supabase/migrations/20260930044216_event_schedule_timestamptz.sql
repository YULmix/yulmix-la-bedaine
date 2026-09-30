-- #149: an event's start and its registration opening carry a time of day, not just a date.
--
--   * events.event_start_date and events.reg_start_date become timestamptz. Existing values
--     become 00:00 America/Toronto on the same date, so no event moves to another day.
--   * Every rule stays calendar-day based, in Toronto time, whatever the session's time zone:
--     registration closes at the end of the Toronto day that falls x_reg_close_weeks weeks before
--     the event's start day, and an event is over after its last day (start day + duration_days).
--     private.toronto_day() is that one conversion.
--   * The time zone is fixed, not per event. The app uses the same constant
--     (src/lib/eventTime.js, EVENT_TIME_ZONE).
--
-- The column names keep their _date suffix: renaming them would touch every query for no change
-- in meaning.
--
-- A client should send full instants (with an offset). A date-only string would be read in the
-- session's time zone (UTC for PostgREST), i.e. the evening before in Toronto.

CREATE FUNCTION private.toronto_day(p_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT (p_at AT TIME ZONE 'America/Toronto')::date;
$$;

COMMENT ON FUNCTION private.toronto_day(timestamptz) IS
  'The calendar day an instant falls on in America/Toronto, the time zone every event date is read in (#149).';

-- Called by private.registration_closed() as whoever is writing, like it.
REVOKE ALL ON FUNCTION private.toronto_day(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.toronto_day(timestamptz) TO authenticated, service_role;

-- The view selects reg_start_date, and #141's trigger fires on UPDATE OF both columns: Postgres
-- won't change a column's type under either, so both go and come back unchanged. (The #141 CHECK
-- and the reg_start_date index are rebuilt by the ALTER itself, and compare instants from now on.)
DROP VIEW public.user_event_history;
DROP TRIGGER events_reg_start_before_event_start ON public.events;

-- The previous app version, until its tab is reloaded, gets ISO timestamps where it expected
-- 'YYYY-MM-DD'. Its display still works: new Date() reads them, and Montréal browsers show the
-- right day. Its event editor's date inputs would show empty. An admin saving from it in that
-- window would write UTC midnight, a few hours off. The table holds a handful of rows, so the
-- lock is momentary.
-- squawk-ignore changing-column-type
ALTER TABLE public.events ALTER COLUMN event_start_date TYPE timestamptz
    USING (event_start_date::timestamp AT TIME ZONE 'America/Toronto');
-- squawk-ignore changing-column-type
ALTER TABLE public.events ALTER COLUMN reg_start_date TYPE timestamptz
    USING (reg_start_date::timestamp AT TIME ZONE 'America/Toronto');

COMMENT ON COLUMN public.events.event_start_date IS
  'When the event itself starts (date and time; shown and entered in America/Toronto), distinct from reg_start_date (when registration opens). Its Toronto day, minus x_reg_close_weeks weeks, is the registration close date. Nullable: enforcement is skipped for events where it is not set.';
COMMENT ON COLUMN public.events.reg_start_date IS
  'When registration opens (date and time; shown and entered in America/Toronto). Must be before event_start_date.';

CREATE TRIGGER events_reg_start_before_event_start
    BEFORE INSERT OR UPDATE OF reg_start_date, event_start_date ON public.events
    FOR EACH ROW EXECUTE FUNCTION private.check_event_reg_start_before_event_start();

CREATE VIEW public.user_event_history WITH (security_invoker = 'true') AS
SELECT p.id AS user_id,
       p.email,
       p.full_name,
       up.id AS party_id,
       e.id AS event_id,
       e.theme AS event_theme,
       e.reg_start_date,
       up.status AS registration_status,
       up.calculated_amount_owed,
       up.payment_status,
       up.created_at AS registration_date,
       up.is_waitlisted
FROM public.profiles p
JOIN public.user_parties up ON p.id = up.user_id
JOIN public.events e ON up.event_id = e.id;

ALTER VIEW public.user_event_history OWNER TO postgres;
COMMENT ON VIEW public.user_event_history IS 'Admin view for drilling down into user participation history';
REVOKE ALL ON TABLE public.user_event_history FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.user_event_history TO authenticated;

-- Closed after the close date's Toronto day ends. Same rule as before, in days.
CREATE OR REPLACE FUNCTION private.registration_closed(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(
        private.toronto_day(now()) > private.toronto_day(e.event_start_date) - (e.x_reg_close_weeks * 7),
        false)
    FROM public.events e
    WHERE e.id = p_event_id;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_today date := private.toronto_day(now());
    v_locked record;
BEGIN
    -- Errors are stable English codes (MESSAGE) with their parameters as JSON (DETAIL); the app
    -- maps them to French in src/lib/dbErrors.js. No user-facing text lives in the database.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'not_authenticated';
    END IF;

    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND email = 'yulmixalabedaine@gmail.com') THEN
        RAISE EXCEPTION USING MESSAGE = 'root_admin_cannot_be_deleted';
    END IF;

    -- Already deleted: nothing left to do.
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND deleted_at IS NOT NULL) THEN
        RETURN;
    END IF;

    -- "Still to come": not archived, and not over (start day + duration, in Toronto days). An
    -- event with no start date has no close date either, so it never locks.
    SELECT e.theme, private.toronto_day(e.event_start_date) - (e.x_reg_close_weeks * 7) AS close_date INTO v_locked
    FROM public.user_parties up
    JOIN public.events e ON e.id = up.event_id
    WHERE up.user_id = v_uid
      AND up.status IN ('registered', 'pending')
      AND e.status IS DISTINCT FROM 'ARCHIVED'
      AND e.event_start_date IS NOT NULL
      AND e.x_reg_close_weeks IS NOT NULL
      AND private.toronto_day(e.event_start_date) + COALESCE(e.duration_days, 1) > v_today
      AND v_today > private.toronto_day(e.event_start_date) - (e.x_reg_close_weeks * 7)
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION USING
            MESSAGE = 'account_deletion_locked',
            DETAIL = json_build_object('event', v_locked.theme, 'close_date', v_locked.close_date)::text;
    END IF;

    UPDATE public.user_parties up
    SET status = 'cancelled'
    FROM public.events e
    WHERE e.id = up.event_id
      AND up.user_id = v_uid
      AND up.status IN ('registered', 'pending')
      AND e.status IS DISTINCT FROM 'ARCHIVED'
      AND (e.event_start_date IS NULL OR private.toronto_day(e.event_start_date) + COALESCE(e.duration_days, 1) > v_today);

    UPDATE public.profiles SET deleted_at = now() WHERE id = v_uid;
END;
$$;
