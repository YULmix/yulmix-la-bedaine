-- #141: registration must open strictly before the event starts.
--
-- Only the admin event editor checked this. Now the database refuses it too:
--
--   * events_reg_start_before_event_start: the declarative rule. When both dates are set,
--     reg_start_date < event_start_date. A null on either side is not checked.
--   * A BEFORE trigger raises the stable English code event_reg_start_not_before_event_start
--     first, so the app can show French text (src/lib/dbErrors.js, #102); a bare CHECK failure
--     only carries Postgres' own message.
--   * events.reg_start_date loses its hard-coded default (2026-05-01): a new event would have
--     been out of order against any earlier event_start_date. A new event now has no
--     registration date until an admin sets one.
--
-- Existing data checked before writing this: the only production event (Bédaine 2026) opens
-- 2026-09-28 for an event on 2026-10-23, so the constraint validates.

ALTER TABLE public.events ALTER COLUMN reg_start_date DROP DEFAULT;

ALTER TABLE public.events
    ADD CONSTRAINT events_reg_start_before_event_start
    CHECK (reg_start_date IS NULL OR event_start_date IS NULL OR reg_start_date < event_start_date);

CREATE FUNCTION private.check_event_reg_start_before_event_start()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.reg_start_date IS NOT NULL AND NEW.event_start_date IS NOT NULL
       AND NEW.reg_start_date >= NEW.event_start_date THEN
        RAISE EXCEPTION USING MESSAGE = 'event_reg_start_not_before_event_start', ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER events_reg_start_before_event_start
    BEFORE INSERT OR UPDATE OF reg_start_date, event_start_date ON public.events
    FOR EACH ROW EXECUTE FUNCTION private.check_event_reg_start_before_event_start();
