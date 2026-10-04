-- #256 (ADR 0023): every admin grant and removal is logged, next to edition_role_log.
--
--   * admin_role_log: one row each time profiles.is_admin actually flips (granted true or false),
--     with who did it. Filled by an AFTER UPDATE trigger on profiles, whatever the path
--     (admin_set_is_admin() or any other update), never by the client. Admins read it; nobody
--     writes it from the app.
--   * A null is_admin counts as false: going from null to false (or back) grants nothing and logs
--     nothing.
--   * Promoting someone also fires trg_drop_edition_roles_of_profile, whose removals land in
--     edition_role_log. The two AFTER triggers write to different tables, so their order doesn't
--     matter.
--   * No backfill: past grants left no trace to recover.
--
-- Mirrors edition_role_log and private.log_edition_role_change() (20261004124226_edition_roles.sql).
-- admin_set_is_admin() is unchanged.

CREATE TABLE public.admin_role_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    actor_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    granted boolean NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);

-- Read newest first, merged by date with an edition's edition_role_log (« Équipe », #257).
CREATE INDEX admin_role_log_changed_at_idx ON public.admin_role_log (changed_at DESC);
CREATE INDEX admin_role_log_user_id_idx ON public.admin_role_log (user_id);
CREATE INDEX admin_role_log_actor_id_idx ON public.admin_role_log (actor_id);

COMMENT ON TABLE public.admin_role_log IS
    'Every admin grant (granted = true) and removal (false) (#256): who (actor), to whom, when. Written by a trigger on profiles; admins read it.';

-- Logs a flip of profiles.is_admin, with who did it (null for no one: a migration, the service
-- role, an actor whose profile is gone).
CREATE FUNCTION private.log_admin_flag_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF (NEW.is_admin IS TRUE) IS NOT DISTINCT FROM (OLD.is_admin IS TRUE) THEN
        RETURN NEW;
    END IF;
    IF v_actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_actor) THEN
        v_actor := NULL;
    END IF;
    INSERT INTO public.admin_role_log (user_id, actor_id, granted)
    VALUES (NEW.id, v_actor, NEW.is_admin IS TRUE);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_admin_flag_change
AFTER UPDATE OF is_admin ON public.profiles
FOR EACH ROW
WHEN ((NEW.is_admin IS TRUE) IS DISTINCT FROM (OLD.is_admin IS TRUE))
EXECUTE FUNCTION private.log_admin_flag_change();

ALTER TABLE public.admin_role_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin Role Log: Admin reads" ON public.admin_role_log
    FOR SELECT TO authenticated
    USING (public.is_admin());

REVOKE ALL ON TABLE public.admin_role_log FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_role_log TO authenticated;
