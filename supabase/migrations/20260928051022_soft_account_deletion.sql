-- #36: "Supprimer mon compte". Deleting an account is a soft delete: profiles.deleted_at is set,
-- and no row is ever removed (profiles cascades from auth.users and user_parties from profiles,
-- so a hard delete would wipe the member's registration and payment history).
--
--   * delete_my_account() is the only way to set deleted_at. It cancels the member's registrations
--     for events still to come (the same soft status change as #35, so the waitlist is promoted),
--     then stamps deleted_at. It refuses, changing nothing, while the member is registered for an
--     event whose registration close date (#38) has passed: the amount owed stays owed.
--     Registrations for events that are over or archived are history; they are left alone and
--     never block a deletion.
--   * A deleted account has no member access: the member-side RLS policies require
--     is_account_active(), and is_admin() is false for a deleted profile. The member can still
--     read their own profile row, which is how the app knows to show "compte supprimé".
--   * Members can't write deleted_at themselves, not even on their own row.

ALTER TABLE public.profiles ADD COLUMN "deleted_at" timestamptz;

COMMENT ON COLUMN public.profiles."deleted_at" IS
    'Set by delete_my_account() (#36). A deleted profile keeps its history but has no member access.';

-- ---------------------------------------------------------------------------------------------
-- Access helpers.

-- True unless the caller's profile is soft-deleted. A caller with no profile row yet (the
-- sign-up race RegistrationForm handles) counts as active.
CREATE FUNCTION public.is_account_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND deleted_at IS NOT NULL
    );
$$;

ALTER FUNCTION public.is_account_active() OWNER TO "postgres";
REVOKE ALL ON FUNCTION public.is_account_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_active() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND (is_admin = TRUE OR email = 'yulmixalabedaine@gmail.com')
        AND deleted_at IS NULL
    );
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- deleted_at is written only by SECURITY DEFINER code (delete_my_account runs as postgres).
-- A client role writing the table directly keeps the stored value.

CREATE FUNCTION public.protect_profile_deleted_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user IN ('authenticated', 'anon') THEN
        IF TG_OP = 'INSERT' THEN
            NEW.deleted_at := NULL;
        ELSE
            NEW.deleted_at := OLD.deleted_at;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_profile_deleted_at() OWNER TO "postgres";

CREATE TRIGGER trg_protect_profile_deleted_at
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_deleted_at();

-- ---------------------------------------------------------------------------------------------
-- Member-side policies: the same rules as before, for active accounts only. Admin branches are
-- unchanged (is_admin() itself now excludes deleted profiles).

DROP POLICY IF EXISTS "Profiles: User can update own profile" ON public.profiles;
CREATE POLICY "Profiles: User can update own profile"
ON public.profiles FOR UPDATE
USING ((auth.uid() = id AND public.is_account_active()) OR public.is_admin())
WITH CHECK ((auth.uid() = id AND public.is_account_active()) OR public.is_admin());

DROP POLICY IF EXISTS "User Parties: User can read own registrations" ON public.user_parties;
CREATE POLICY "User Parties: User can read own registrations"
ON public.user_parties FOR SELECT
USING ((auth.uid() = user_id AND public.is_account_active()) OR public.is_admin());

DROP POLICY IF EXISTS "User Parties: User can create own registrations" ON public.user_parties;
CREATE POLICY "User Parties: User can create own registrations"
ON public.user_parties FOR INSERT
WITH CHECK ((auth.uid() = user_id AND public.is_account_active()) OR public.is_admin());

DROP POLICY IF EXISTS "User Parties: User can update own registrations" ON public.user_parties;
CREATE POLICY "User Parties: User can update own registrations"
ON public.user_parties FOR UPDATE
USING ((auth.uid() = user_id AND status IN ('registered', 'pending', 'cancelled') AND public.is_account_active()) OR public.is_admin())
WITH CHECK ((auth.uid() = user_id AND status IN ('registered', 'pending', 'cancelled') AND public.is_account_active()) OR public.is_admin());

DROP POLICY IF EXISTS "App Feedback: Users can insert own feedback" ON public.app_feedback;
CREATE POLICY "App Feedback: Users can insert own feedback"
ON public.app_feedback FOR INSERT
WITH CHECK (auth.uid() = user_id AND public.is_account_active());

DROP POLICY IF EXISTS "App Feedback: Users can read own feedback" ON public.app_feedback;
CREATE POLICY "App Feedback: Users can read own feedback"
ON public.app_feedback FOR SELECT
USING ((auth.uid() = user_id AND public.is_account_active()) OR public.is_admin());

DROP POLICY IF EXISTS "App Feedback: Users can update own feedback" ON public.app_feedback;
CREATE POLICY "App Feedback: Users can update own feedback"
ON public.app_feedback FOR UPDATE
USING ((auth.uid() = user_id AND public.is_account_active()) OR public.is_admin())
WITH CHECK ((auth.uid() = user_id AND public.is_account_active()) OR public.is_admin());

DROP POLICY IF EXISTS "Registration Edits: System can insert edit records" ON public.registration_edits;
CREATE POLICY "Registration Edits: System can insert edit records"
ON public.registration_edits FOR INSERT
WITH CHECK ((edited_by = auth.uid() AND public.is_account_active()) OR public.is_admin());

DROP POLICY IF EXISTS "Registration Edits: Users can see their own edit history" ON public.registration_edits;
CREATE POLICY "Registration Edits: Users can see their own edit history"
ON public.registration_edits FOR SELECT
USING ((edited_by = auth.uid() AND public.is_account_active()) OR public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- The RPC.

CREATE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
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

    -- "Still to come": not archived, and not over (start date + duration). An event with no start
    -- date has no close date either, so it never locks.
    SELECT e.theme, e.event_start_date - (e.x_reg_close_weeks * 7) AS close_date INTO v_locked
    FROM public.user_parties up
    JOIN public.events e ON e.id = up.event_id
    WHERE up.user_id = v_uid
      AND up.status IN ('registered', 'pending')
      AND e.status IS DISTINCT FROM 'ARCHIVED'
      AND e.event_start_date IS NOT NULL
      AND e.x_reg_close_weeks IS NOT NULL
      AND e.event_start_date + COALESCE(e.duration_days, 1) > CURRENT_DATE
      AND CURRENT_DATE > e.event_start_date - (e.x_reg_close_weeks * 7)
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
      AND (e.event_start_date IS NULL OR e.event_start_date + COALESCE(e.duration_days, 1) > CURRENT_DATE);

    UPDATE public.profiles SET deleted_at = now() WHERE id = v_uid;
END;
$$;

ALTER FUNCTION public.delete_my_account() OWNER TO "postgres";
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
