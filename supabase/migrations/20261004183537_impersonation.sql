-- #265 (ADR 0025): « Voir comme », read-only impersonation of a member by an admin. Database side.
--
--   * impersonation_log: one row per « Voir comme » session. The impersonate Edge Function (#266)
--     inserts it with the service role; the custom access token hook claims it (session_id) as
--     supabase_auth_admin; admins read it. anon and authenticated write nothing, admins included.
--     A trigger refuses a target who is an admin, deleted or the admin themself, and an actor who
--     isn't an active admin; it fixes started_at to now() and expires_at to 30 minutes later, and
--     keeps both from being pushed back (a session is never extended).
--   * public.custom_access_token_hook(event): Supabase Auth calls it before issuing every access
--     token. Only a magic-link/OTP sign-in matching a fresh pending row (< 60 s, no session yet)
--     gets the impersonated_by claim and an exp capped at the row's expires_at; a refresh of that
--     session keeps both, or is refused once the row has expired or ended. Every other token passes
--     through unchanged. It never raises on its own: an error here would lock everyone out.
--   * private.refuse_when_impersonating(): a BEFORE INSERT OR UPDATE OR DELETE ... FOR EACH
--     STATEMENT trigger on every table in public and private. It raises read_only_impersonation
--     when the caller's JWT carries impersonated_by. A trigger fires inside SECURITY DEFINER
--     functions too, so no function needs its own guard. src/__tests__/rlsPolicies.test.js fails
--     when a table lacks it: a migration adding a table must attach it.
--
-- No existing function, policy or trigger is redefined.

-- ---------------------------------------------------------------------------------------------
-- The read-only guard.

CREATE FUNCTION private.refuse_when_impersonating()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF COALESCE(auth.jwt() ? 'impersonated_by', false) THEN
        RAISE EXCEPTION USING MESSAGE = 'read_only_impersonation', ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION private.refuse_when_impersonating() IS
    'Statement trigger on every table in public and private (#265, ADR 0025): refuses any write from a « Voir comme » session (JWT claim impersonated_by).';

-- ---------------------------------------------------------------------------------------------
-- impersonation_log.

CREATE TABLE public.impersonation_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Null only once the account is hard-deleted (as admin_role_log): the row stays.
    admin_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    target_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
    session_id uuid,
    ended_at timestamptz,
    CONSTRAINT impersonation_log_not_self CHECK (admin_id <> target_id),
    CONSTRAINT impersonation_log_thirty_minutes
        CHECK (expires_at > started_at AND expires_at <= started_at + interval '30 minutes')
);

-- The hook finds a refreshed session by its id, and a pending row by its target.
CREATE UNIQUE INDEX impersonation_log_session_id_idx ON public.impersonation_log (session_id);
CREATE INDEX impersonation_log_target_pending_idx ON public.impersonation_log (target_id, started_at DESC)
    WHERE session_id IS NULL;
CREATE INDEX impersonation_log_admin_id_idx ON public.impersonation_log (admin_id);
CREATE INDEX impersonation_log_started_at_idx ON public.impersonation_log (started_at DESC);

COMMENT ON TABLE public.impersonation_log IS
    '« Voir comme » sessions (#265, ADR 0025): which admin viewed the app as which member, when, for how long. Inserted by the impersonate Edge Function, claimed by custom_access_token_hook; admins read it.';
COMMENT ON COLUMN public.impersonation_log.session_id IS
    'The Supabase Auth session (JWT session_id) the hook tied to this row; null until the magic-link sign-in.';
COMMENT ON COLUMN public.impersonation_log.ended_at IS
    'Set when the session is ended early (« Quitter »); its refreshes are refused from then on.';

-- Who may be impersonated, by whom, and for how long. Runs as the definer to read profiles
-- whoever inserts (the service role has no grant on profiles).
CREATE FUNCTION private.check_impersonation_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target public.profiles;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = NEW.admin_id
              AND (is_admin IS TRUE OR email = 'yulmixalabedaine@gmail.com')
              AND deleted_at IS NULL
        ) THEN
            RAISE EXCEPTION USING MESSAGE = 'impersonation_actor_not_admin', ERRCODE = '42501';
        END IF;
        IF NEW.target_id = NEW.admin_id THEN
            RAISE EXCEPTION USING MESSAGE = 'impersonation_target_self', ERRCODE = 'check_violation';
        END IF;
        SELECT * INTO v_target FROM public.profiles WHERE id = NEW.target_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING MESSAGE = 'impersonation_target_not_found', ERRCODE = 'no_data_found';
        END IF;
        IF v_target.is_admin IS TRUE OR v_target.email = 'yulmixalabedaine@gmail.com' THEN
            RAISE EXCEPTION USING MESSAGE = 'impersonation_target_admin', ERRCODE = 'check_violation';
        END IF;
        IF v_target.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION USING MESSAGE = 'impersonation_target_deleted', ERRCODE = 'check_violation';
        END IF;
        -- The clock is the database's: a session starts now and lasts 30 minutes.
        NEW.started_at := now();
        NEW.expires_at := now() + interval '30 minutes';
        NEW.session_id := NULL;
        NEW.ended_at := NULL;
        RETURN NEW;
    END IF;

    -- UPDATE: the hook sets session_id once; « Quitter » sets ended_at; a session may be cut
    -- short (expires_at earlier) but never extended nor reassigned. An id only goes to null, when
    -- its account is hard-deleted (ON DELETE SET NULL).
    IF (NEW.admin_id IS DISTINCT FROM OLD.admin_id AND NEW.admin_id IS NOT NULL)
       OR (NEW.target_id IS DISTINCT FROM OLD.target_id AND NEW.target_id IS NOT NULL)
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.expires_at > OLD.expires_at
       OR (OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id)
       OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at) THEN
        RAISE EXCEPTION USING MESSAGE = 'impersonation_log_immutable', ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_impersonation_log
BEFORE INSERT OR UPDATE ON public.impersonation_log
FOR EACH ROW
EXECUTE FUNCTION private.check_impersonation_log();

ALTER TABLE public.impersonation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Impersonation Log: Admin reads" ON public.impersonation_log
    FOR SELECT TO authenticated
    USING (public.is_admin());

-- The hook runs as supabase_auth_admin, which RLS applies to.
CREATE POLICY "Impersonation Log: Auth reads" ON public.impersonation_log
    FOR SELECT TO supabase_auth_admin
    USING (true);

CREATE POLICY "Impersonation Log: Auth claims" ON public.impersonation_log
    FOR UPDATE TO supabase_auth_admin
    USING (true)
    WITH CHECK (true);

REVOKE ALL ON TABLE public.impersonation_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.impersonation_log TO authenticated;
-- The Edge Function (#266) starts a session and ends it early (« Quitter »).
GRANT SELECT, INSERT, UPDATE (ended_at) ON TABLE public.impersonation_log TO service_role;
GRANT SELECT, UPDATE (session_id) ON TABLE public.impersonation_log TO supabase_auth_admin;

-- ---------------------------------------------------------------------------------------------
-- The custom access token hook (https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
-- Input: { user_id, claims, authentication_method }. Output: the event with its claims, or
-- { error: { http_code, message } } to refuse the token.

CREATE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    v_claims jsonb;
    v_user_id uuid;
    v_session_id uuid;
    v_row public.impersonation_log;
    v_cap bigint;
BEGIN
    IF event IS NULL OR jsonb_typeof(event) <> 'object' OR jsonb_typeof(event->'claims') IS DISTINCT FROM 'object' THEN
        RETURN event;
    END IF;

    -- The claim only ever comes from here, never from upstream.
    v_claims := (event->'claims') - 'impersonated_by';
    IF (v_claims->>'session_id') ~ c_uuid THEN
        v_session_id := (v_claims->>'session_id')::uuid;
    END IF;
    IF (event->>'user_id') ~ c_uuid THEN
        v_user_id := (event->>'user_id')::uuid;
    END IF;

    BEGIN
        IF v_session_id IS NOT NULL AND v_user_id IS NOT NULL THEN
            -- A session already tied to a « Voir comme » row: its refresh.
            SELECT * INTO v_row FROM public.impersonation_log WHERE session_id = v_session_id;
            IF FOUND THEN
                IF v_row.ended_at IS NOT NULL OR clock_timestamp() >= v_row.expires_at OR v_row.target_id IS DISTINCT FROM v_user_id THEN
                    RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'impersonation_ended'));
                END IF;
            -- The Edge Function's magic-link sign-in, right after it inserted the row.
            ELSIF event->>'authentication_method' IN ('otp', 'magiclink') THEN
                UPDATE public.impersonation_log
                SET session_id = v_session_id
                WHERE id = (
                    SELECT id FROM public.impersonation_log
                    WHERE target_id = v_user_id
                      AND session_id IS NULL
                      AND ended_at IS NULL
                      AND started_at > now() - interval '60 seconds'
                      AND expires_at > clock_timestamp()
                    ORDER BY started_at DESC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING * INTO v_row;
            END IF;

            IF v_row.id IS NOT NULL THEN
                v_cap := floor(extract(epoch FROM v_row.expires_at))::bigint;
                RETURN jsonb_set(event, '{claims}', v_claims || jsonb_build_object(
                    'impersonated_by', v_row.admin_id::text,
                    'exp', CASE
                        WHEN jsonb_typeof(v_claims->'exp') = 'number' AND (v_claims->>'exp')::numeric < v_cap
                            THEN v_claims->'exp'
                        ELSE to_jsonb(v_cap)
                    END
                ));
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Fail closed for a « Voir comme » session, open for everyone else.
        BEGIN
            IF EXISTS (SELECT 1 FROM public.impersonation_log WHERE session_id = v_session_id) THEN
                RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'impersonation_ended'));
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END;

    RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
    'Supabase Auth custom access token hook (#265, ADR 0025): adds impersonated_by and caps exp for a « Voir comme » session, refuses its refresh once expired or ended; every other token passes through.';

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- ---------------------------------------------------------------------------------------------
-- Attach the guard to every table in public and private, impersonation_log included. Tables an
-- extension owns are the extension's business.

DO $$
DECLARE
    v_table regclass;
BEGIN
    FOR v_table IN
        SELECT c.oid::regclass
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'private')
          AND c.relkind IN ('r', 'p')
          AND NOT c.relispartition
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
          )
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_refuse_when_impersonating BEFORE INSERT OR UPDATE OR DELETE ON %s '
            'FOR EACH STATEMENT EXECUTE FUNCTION private.refuse_when_impersonating()',
            v_table
        );
    END LOOP;
END;
$$;
