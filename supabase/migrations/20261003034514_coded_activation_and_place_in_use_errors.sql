-- #198: two conditions the app used to recognise by raw SQLSTATE now raise named codes
-- (ADR 0021); src/lib/dbErrors.ts maps them to French.
--
--   * event_already_active: making an event active while another is. The unique index
--     only_one_active_event stays as the backstop for a race; this check fires first, so the
--     usual refusal carries a code instead of a bare 23505.
--   * place_in_use: deleting a place (or the location holding it) someone was given. Until now
--     the place_assignments foreign key refused it, as a bare 23503.

CREATE FUNCTION private.guard_single_active_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.is_active IS TRUE AND EXISTS (
        SELECT 1 FROM public.events e WHERE e.is_active AND e.id <> NEW.id
    ) THEN
        RAISE EXCEPTION USING MESSAGE = 'event_already_active', ERRCODE = 'unique_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_single_active_event() FROM PUBLIC;

CREATE TRIGGER trg_guard_single_active_event
BEFORE INSERT OR UPDATE OF is_active ON public.events
FOR EACH ROW EXECUTE FUNCTION private.guard_single_active_event();

CREATE FUNCTION private.guard_place_in_use()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.place_assignments pa WHERE pa.place_id = OLD.id) THEN
        RAISE EXCEPTION USING MESSAGE = 'place_in_use', ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_place_in_use() FROM PUBLIC;

CREATE TRIGGER trg_guard_place_in_use
BEFORE DELETE ON public.places
FOR EACH ROW EXECUTE FUNCTION private.guard_place_in_use();
