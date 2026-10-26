-- Post-mortem feedback opens on the event's first day (#339, amends ADR 0029).
-- Was: opens the day after the event's last day. Now: from the Toronto day of the start.
-- The close is unchanged: the end of the Toronto day "last day + feedback_days", i.e. midnight
-- starting the day (start day + duration_days + feedback_days). Opening earlier doesn't shorten it.
-- Redefines private.event_feedback_dates(), copied from 20261026043829_event_feedback.sql; the
-- only differences are opens_on (now the start day) and the closes_on / closes_at expressions
-- (now computed from the last day + 1, what opens_on used to be). Same signature, so every caller
-- (event_feedback_window, event_feedback_due, the three SECURITY DEFINER functions) is unchanged.
CREATE OR REPLACE FUNCTION private.event_feedback_dates(e public.events, OUT opens_on date, OUT closes_on date, OUT closes_at timestamptz)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT d.first_day,
           d.first_day + COALESCE(e.duration_days, 1) + e.feedback_days - 1,
           ((d.first_day + COALESCE(e.duration_days, 1) + e.feedback_days)::timestamp AT TIME ZONE 'America/Toronto')
    FROM (SELECT private.toronto_day(e.event_start_date) AS first_day) d;
$$;
