-- #217 (ADR 0023): edition roles. Access is a ladder: Member < Comité < Organisateur < Admin.
-- Comité and Organisateur are granted per edition (event) by an admin; Admin stays per account
-- (profiles.is_admin). Everything checks public.edition_role(event_id).
--
--   * edition_roles: who has which role on which edition. Admins write it (RLS and
--     set_edition_role()); a member reads their own rows. An admin can't hold one: granting one
--     to an admin is refused, and becoming an admin, or deleting one's account, removes them.
--   * edition_role_log: every grant, change and removal, filled by a trigger. Admins read it.
--   * edition_role(event) → 'admin' | 'organiser' | 'committee' | null, and
--     has_edition_role(event, min) for the ladder.
--   * Reads: Comité and above on an event read its user_parties, their attendees (and so their
--     places, through the existing policies), the registrants' profiles (and the change
--     history's authors), and its registration_edits. event_places() opens to Comité.
--     Organisateur and above read and write its event_budgets.
--     Comité and above read the « assignments » gallery of the venue their edition is held at
--     (any of its editions, for a shared venue); Organisateur and above read the email_log of
--     their edition's parties (Résumé's email problems). Writing both stays admin-only.
--   * Writes for Organisateur go through functions that check the role, never through the
--     user_parties UPDATE policy (it would let them change every column):
--       set_payment_status(party, status), save_logistics(changes) (now per party's event),
--       apply_event_pricing(event, price, ratio).
--     They mark the party they write in a transaction-local setting (bedaine.organiser_party),
--     which protect_admin_only_party_fields() lets through, as save_registration() does with
--     bedaine.saving_party. PostgREST offers clients no way to set it.
--   * attendees: reading follows the party, as before; writing now needs one's own party or
--     admin, so reading a party (Comité) never lets anyone write its attendees.
--   * save_registration() for someone else stays admin-only: its party lookup and writes run
--     under the caller's RLS, which gives only an admin someone else's row.
--   * party_admin_notes (#227, admin-only until now): Comité and above on the party's edition
--     read them, Organisateur and above write them (the "once #217 lands" clause of #227).
--   * save_logistics() and event_places() become SECURITY DEFINER, so #237's restrictive policy
--     ("Attendees: removed ones are hidden") no longer filters their reads of attendees: each
--     filters `deleted_at IS NULL` itself, as #237's other definer functions do.
--
-- Functions redefined here, each copied from its latest definition on main:
--   protect_admin_only_party_fields                  20261004021924_party_admin_notes.sql (#227)
--   save_logistics                                   20261004021924_party_admin_notes.sql (#227)
--   event_places                                     20261001225145_event_places.sql

-- ---------------------------------------------------------------------------------------------
-- The roles and their log.

CREATE TABLE public.edition_roles (
    event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    role text NOT NULL CONSTRAINT edition_roles_role_check CHECK (role IN ('committee', 'organiser')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX edition_roles_user_id_idx ON public.edition_roles (user_id);

COMMENT ON TABLE public.edition_roles IS
    'Edition roles (#217, ADR 0023): Comité (committee) or Organisateur (organiser) for one event. Admins only write it.';

CREATE TABLE public.edition_role_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    actor_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    old_role text,
    new_role text,
    changed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT edition_role_log_changes_something CHECK (old_role IS DISTINCT FROM new_role)
);

CREATE INDEX edition_role_log_event_id_idx ON public.edition_role_log (event_id, changed_at DESC);
CREATE INDEX edition_role_log_user_id_idx ON public.edition_role_log (user_id);
CREATE INDEX edition_role_log_actor_id_idx ON public.edition_role_log (actor_id);

COMMENT ON TABLE public.edition_role_log IS
    'Every grant, change and removal of an edition role (#217): who (actor), to whom, which edition, old and new role. Written by a trigger; admins read it.';

-- ---------------------------------------------------------------------------------------------
-- The role functions.

-- A role's rung on the ladder; null for anything else (no role).
CREATE FUNCTION private.edition_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_role WHEN 'committee' THEN 1 WHEN 'organiser' THEN 2 WHEN 'admin' THEN 3 END;
$$;

-- The caller's role on an event: 'admin' on every event for an admin, else their edition role,
-- else null. A deleted account has none.
CREATE FUNCTION public.edition_role(p_event_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN public.is_admin() THEN 'admin'
        WHEN NOT public.is_account_active() THEN NULL
        ELSE (SELECT r.role FROM public.edition_roles r
              WHERE r.event_id = p_event_id AND r.user_id = auth.uid())
    END;
$$;

COMMENT ON FUNCTION public.edition_role(uuid) IS
    'The caller''s role on an event (#217, ADR 0023): admin, organiser, committee, or null.';

-- Whether the caller's role on an event is at least p_min_role ('committee', 'organiser', 'admin').
CREATE FUNCTION public.has_edition_role(p_event_id uuid, p_min_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        private.edition_role_rank(public.edition_role(p_event_id)) >= private.edition_role_rank(p_min_role),
        false
    );
$$;

COMMENT ON FUNCTION public.has_edition_role(uuid, text) IS
    'Whether the caller''s role on an event is at least the given one, on the ladder committee < organiser < admin (#217).';

-- Whether the caller, through an edition role, may read a profile: a registrant of an edition
-- they have a role on, or the author of a change to one of its registrations (the history names
-- them). Admins read every profile through their own policy.
CREATE FUNCTION private.edition_team_reads_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (SELECT 1 FROM public.edition_roles WHERE user_id = auth.uid())
       AND public.is_account_active()
       AND (
           EXISTS (SELECT 1
                   FROM public.user_parties up
                   JOIN public.edition_roles r ON r.event_id = up.event_id AND r.user_id = auth.uid()
                   WHERE up.user_id = p_profile_id)
           OR EXISTS (SELECT 1
                      FROM public.registration_edits re
                      JOIN public.user_parties up ON up.id = re.registration_id
                      JOIN public.edition_roles r ON r.event_id = up.event_id AND r.user_id = auth.uid()
                      WHERE re.edited_by = p_profile_id)
       );
$$;

REVOKE ALL ON FUNCTION private.edition_role_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.edition_team_reads_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.edition_role_rank(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.edition_team_reads_profile(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.edition_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_edition_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edition_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_edition_role(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- The roles' rules and log.

-- An admin can't hold an edition role, nor can a deleted account. A row changes role only: its
-- edition and person are its identity (and the log's).
CREATE FUNCTION private.enforce_edition_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION USING MESSAGE = 'edition_role_invalid', ERRCODE = 'check_violation';
        END IF;
        NEW.updated_at := now();
    END IF;

    -- FOR SHARE: a promotion to admin or an account deletion committing meanwhile waits for this
    -- write, then its trigger removes the role; or this write waits for it, and sees the change.
    SELECT * INTO v_profile FROM public.profiles WHERE id = NEW.user_id FOR SHARE;
    -- An unknown person is left to the foreign key.
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF v_profile.is_admin IS TRUE OR v_profile.email = 'yulmixalabedaine@gmail.com' THEN
        RAISE EXCEPTION USING MESSAGE = 'edition_role_target_admin', ERRCODE = 'check_violation';
    END IF;
    IF v_profile.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'edition_role_target_deleted', ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_edition_role
BEFORE INSERT OR UPDATE ON public.edition_roles
FOR EACH ROW EXECUTE FUNCTION private.enforce_edition_role();

-- Logs every grant (insert), change (update of the role) and removal (delete), with who did it.
-- A removal because the person's profile itself is being deleted isn't logged: there is no one
-- left to name.
CREATE FUNCTION private.log_edition_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    -- An actor whose profile is gone (or a service context) is no one.
    IF v_actor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_actor) THEN
        v_actor := NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.edition_role_log (event_id, user_id, actor_id, old_role, new_role)
        VALUES (NEW.event_id, NEW.user_id, v_actor, NULL, NEW.role);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            INSERT INTO public.edition_role_log (event_id, user_id, actor_id, old_role, new_role)
            VALUES (NEW.event_id, NEW.user_id, v_actor, OLD.role, NEW.role);
        END IF;
        RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id)
       AND EXISTS (SELECT 1 FROM public.events WHERE id = OLD.event_id) THEN
        INSERT INTO public.edition_role_log (event_id, user_id, actor_id, old_role, new_role)
        VALUES (OLD.event_id, OLD.user_id, v_actor, OLD.role, NULL);
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_log_edition_role_change
AFTER INSERT OR UPDATE OR DELETE ON public.edition_roles
FOR EACH ROW EXECUTE FUNCTION private.log_edition_role_change();

-- Becoming an admin, or deleting one's account (#36), removes one's edition roles (logged).
CREATE FUNCTION private.drop_edition_roles_of_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.edition_roles WHERE user_id = NEW.id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_drop_edition_roles_of_profile
AFTER UPDATE OF is_admin, deleted_at ON public.profiles
FOR EACH ROW
WHEN ((NEW.is_admin IS TRUE AND OLD.is_admin IS NOT TRUE)
      OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL))
EXECUTE FUNCTION private.drop_edition_roles_of_profile();

-- ---------------------------------------------------------------------------------------------
-- Access to the roles and the log.

ALTER TABLE public.edition_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_role_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Edition Roles: Admin full access" ON public.edition_roles
    FOR ALL TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Edition Roles: User reads own roles" ON public.edition_roles
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() AND public.is_account_active());

CREATE POLICY "Edition Role Log: Admin reads" ON public.edition_role_log
    FOR SELECT TO authenticated
    USING (public.is_admin());

REVOKE ALL ON TABLE public.edition_roles, public.edition_role_log FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.edition_roles TO authenticated;
GRANT SELECT ON TABLE public.edition_role_log TO authenticated;

-- Grants (role), changes it, or removes it (null). Admins only; the table's trigger refuses an
-- admin or a deleted account as the target. Granting the role someone already has changes nothing
-- (and logs nothing).
CREATE FUNCTION public.set_edition_role(p_event_id uuid, p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;
    IF p_role IS NOT NULL AND p_role NOT IN ('committee', 'organiser') THEN
        RAISE EXCEPTION USING MESSAGE = 'edition_role_invalid', ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
        RAISE EXCEPTION USING MESSAGE = 'event_not_found', ERRCODE = 'no_data_found';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION USING MESSAGE = 'edition_role_target_not_found', ERRCODE = 'no_data_found';
    END IF;

    IF p_role IS NULL THEN
        DELETE FROM public.edition_roles WHERE event_id = p_event_id AND user_id = p_user_id;
    ELSE
        INSERT INTO public.edition_roles AS r (event_id, user_id, role)
        VALUES (p_event_id, p_user_id, p_role)
        ON CONFLICT (event_id, user_id) DO UPDATE SET role = EXCLUDED.role
        WHERE r.role IS DISTINCT FROM EXCLUDED.role;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.set_edition_role(uuid, uuid, text) IS
    'Grants, changes (committee, organiser) or removes (null) someone''s role on an edition (#217). Admins only; logged.';

REVOKE ALL ON FUNCTION public.set_edition_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_edition_role(uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reads: an edition's team (Comité and above) reads its registrations.

CREATE POLICY "User Parties: Edition team reads its edition" ON public.user_parties
    FOR SELECT TO authenticated
    USING (public.has_edition_role(event_id, 'committee'));

-- Reading an attendee still follows its party (so the team reads its edition's, and through the
-- place policies, where they sleep). Writing one needs one's own party, or admin: being able to
-- read a party must not let anyone write its attendees. (Writes go through save_registration()
-- anyway, trg_guard_attendee_write.)
DROP POLICY "Attendees: same access as their party" ON public.attendees;
CREATE POLICY "Attendees: read with their party" ON public.attendees
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_parties up WHERE up.id = party_id));
CREATE POLICY "Attendees: insert into own party or admin" ON public.attendees
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_parties up WHERE up.id = party_id
                        AND ((up.user_id = auth.uid() AND public.is_account_active()) OR public.is_admin())));
CREATE POLICY "Attendees: update in own party or admin" ON public.attendees
    FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_parties up WHERE up.id = party_id
                   AND ((up.user_id = auth.uid() AND public.is_account_active()) OR public.is_admin())))
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_parties up WHERE up.id = party_id
                        AND ((up.user_id = auth.uid() AND public.is_account_active()) OR public.is_admin())));
CREATE POLICY "Attendees: delete from own party or admin" ON public.attendees
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_parties up WHERE up.id = party_id
                   AND ((up.user_id = auth.uid() AND public.is_account_active()) OR public.is_admin())));

CREATE POLICY "Profiles: Edition team reads its edition's people" ON public.profiles
    FOR SELECT TO authenticated
    USING (private.edition_team_reads_profile(id));

CREATE POLICY "Registration Edits: Edition team reads its edition's history" ON public.registration_edits
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_parties up
                   WHERE up.id = registration_id AND public.has_edition_role(up.event_id, 'committee')));

-- The budget: Organisateur and above, read and write.
DROP POLICY "Event Budgets: Admin full access" ON public.event_budgets;
CREATE POLICY "Event Budgets: Organisateur and above" ON public.event_budgets
    FOR ALL TO authenticated
    USING (public.has_edition_role(event_id, 'organiser'))
    WITH CHECK (public.has_edition_role(event_id, 'organiser'));

-- The venue's « assignments » gallery (#177, admins only until now): the team of any edition held
-- at the venue reads it. Its images follow through "Gallery Images: Read with their gallery";
-- the files are in a public bucket. events is read under its own RLS, as the other gallery
-- policies read their owners.
CREATE POLICY "Galleries: Edition team reads its venue's assignments gallery" ON public.galleries
    FOR SELECT TO authenticated
    USING (kind = 'assignments'
           AND EXISTS (SELECT 1 FROM public.events e
                       WHERE e.venue_id = galleries.venue_id AND public.has_edition_role(e.id, 'committee')));

-- The emails sent about an edition's parties (#93): Organisateur and above follow up the ones that
-- failed. Writing stays the Edge Function's (service role).
CREATE POLICY "Email Log: Organisateur and above read their edition's" ON public.email_log
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_parties up
                   WHERE up.id = email_log.party_id AND public.has_edition_role(up.event_id, 'organiser')));

-- ---------------------------------------------------------------------------------------------
-- The organisers' notes (#227): Comité and above on the party's edition read them, Organisateur
-- and above write them (admins included: has_edition_role() is 'admin' for them on every event).
-- Members still have no access of any kind. The party is read under the caller's RLS, which
-- shows an edition's team that edition's parties.

DROP POLICY "Party Admin Notes: Admin full access" ON public.party_admin_notes;
CREATE POLICY "Party Admin Notes: Edition team reads its edition's" ON public.party_admin_notes
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_parties up
                   WHERE up.id = party_id AND public.has_edition_role(up.event_id, 'committee')));
CREATE POLICY "Party Admin Notes: Organisateur and above insert" ON public.party_admin_notes
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_parties up
                        WHERE up.id = party_id AND public.has_edition_role(up.event_id, 'organiser')));
CREATE POLICY "Party Admin Notes: Organisateur and above update" ON public.party_admin_notes
    FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_parties up
                   WHERE up.id = party_id AND public.has_edition_role(up.event_id, 'organiser')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_parties up
                        WHERE up.id = party_id AND public.has_edition_role(up.event_id, 'organiser')));
CREATE POLICY "Party Admin Notes: Organisateur and above delete" ON public.party_admin_notes
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_parties up
                   WHERE up.id = party_id AND public.has_edition_role(up.event_id, 'organiser')));

-- ---------------------------------------------------------------------------------------------
-- The admin-only party fields: as in 20261004021924_party_admin_notes.sql (#227), plus the party a
-- role-checking function is writing (bedaine.organiser_party).

CREATE OR REPLACE FUNCTION public.protect_admin_only_party_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' AND auth.role() IS DISTINCT FROM 'anon' THEN
        RETURN NEW;
    END IF;
    IF public.is_admin() THEN
        RETURN NEW;
    END IF;
    -- set_payment_status() and save_logistics() checked the caller's role on this party's event.
    IF current_setting('bedaine.organiser_party', true) = NEW.id::text THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.payment_status := 'unpaid';
        NEW.message_to_participants := NULL;
    ELSE
        NEW.payment_status := OLD.payment_status;
        NEW.message_to_participants := OLD.message_to_participants;
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Organisateur writes.

-- A party's payment status, for Organisateur and above on its event. Only that column changes.
CREATE FUNCTION public.set_payment_status(p_party_id uuid, p_payment_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event_id uuid;
BEGIN
    SELECT event_id INTO v_event_id FROM public.user_parties WHERE id = p_party_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING MESSAGE = 'party_not_found', ERRCODE = 'no_data_found';
    END IF;
    IF NOT public.has_edition_role(v_event_id, 'organiser') THEN
        RAISE EXCEPTION USING MESSAGE = 'organiser_only', ERRCODE = '42501';
    END IF;
    IF p_payment_status IS NULL OR p_payment_status NOT IN ('unpaid', 'paid') THEN
        RAISE EXCEPTION USING MESSAGE = 'payment_status_invalid', ERRCODE = '22023';
    END IF;

    PERFORM set_config('bedaine.organiser_party', p_party_id::text, true);
    UPDATE public.user_parties SET payment_status = p_payment_status WHERE id = p_party_id;
    PERFORM set_config('bedaine.organiser_party', '', true);
END;
$$;

COMMENT ON FUNCTION public.set_payment_status(uuid, text) IS
    'Sets a party''s payment status (#217): Organisateur and above on its event. Nothing else of the party changes.';

-- The event's base price and main-event ratio, for Organisateur and above on it. Only those two
-- columns change; the events triggers lock the registrations still unpriced (#117).
CREATE FUNCTION public.apply_event_pricing(p_event_id uuid, p_selling_price_whole_event numeric, p_ratio_main_whole numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_edition_role(p_event_id, 'organiser') THEN
        RAISE EXCEPTION USING MESSAGE = 'organiser_only', ERRCODE = '42501';
    END IF;

    UPDATE public.events
    SET selling_price_whole_event = p_selling_price_whole_event,
        ratio_main_whole = p_ratio_main_whole
    WHERE id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING MESSAGE = 'event_not_found', ERRCODE = 'no_data_found';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.apply_event_pricing(uuid, numeric, numeric) IS
    'Sets an event''s base price and main-event ratio (#217): Organisateur and above on it.';

REVOKE ALL ON FUNCTION public.set_payment_status(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_event_pricing(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_payment_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_event_pricing(uuid, numeric, numeric) TO authenticated;

-- As in 20261004021924_party_admin_notes.sql (#227), except who may call it (#217): Organisateur
-- and above on each party's event, checked per party. It is now SECURITY DEFINER, since an
-- organiser has no write policy on place_assignments or user_parties; the message is written
-- under bedaine.organiser_party. A caller who is neither admin nor organiser of any edition is
-- refused up front. Being SECURITY DEFINER, it checks attendees.deleted_at itself (#237).
--
-- p_changes: [{ "party_id": uuid,
--               "admin_notes": text,                       -- optional: absent = unchanged
--               "message_to_participants": text,           -- optional: absent = unchanged
--               "places": { "<attendee id>": "<place id>" | null } }]   -- null = unassign
CREATE OR REPLACE FUNCTION public.save_logistics(p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_party jsonb;
    v_party_id uuid;
    v_event_id uuid;
    v_place record;
    v_places_before jsonb;
    v_place_changes jsonb;
    v_pending jsonb;
    v_failed jsonb := '[]'::jsonb;
    v_state text;
    v_message text;
    v_details text;
BEGIN
    -- #217: Organisateur and above; checked again on each party's event below.
    IF NOT public.is_admin()
       AND NOT (public.is_account_active()
                AND EXISTS (SELECT 1 FROM public.edition_roles
                            WHERE user_id = auth.uid() AND role = 'organiser')) THEN
        RAISE EXCEPTION USING MESSAGE = 'organiser_only', ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION USING MESSAGE = 'logistics_changes_invalid', ERRCODE = '22023';
    END IF;

    FOR v_party IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
        v_party_id := NULL;
        BEGIN
            v_party_id := (v_party->>'party_id')::uuid;

            SELECT event_id INTO v_event_id FROM public.user_parties WHERE id = v_party_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION USING MESSAGE = 'logistics_party_not_found', ERRCODE = 'no_data_found';
            END IF;
            -- #217: the role on this party's event, before locking anything of it.
            IF NOT public.has_edition_role(v_event_id, 'organiser') THEN
                RAISE EXCEPTION USING MESSAGE = 'organiser_only', ERRCODE = '42501';
            END IF;

            -- Two saves of one party take turns, so the before snapshot is what this save changes.
            PERFORM 1 FROM public.user_parties WHERE id = v_party_id FOR UPDATE;
            v_places_before := private.party_places_snapshot(v_party_id);

            -- This party's history entry, collected as it saves: its places here, its notes by
            -- party_admin_notes' trigger. log_registration_edit takes it when the update below
            -- writes an entry (and clears it), else it's written at the end.
            PERFORM set_config('bedaine.logistics_changes',
                jsonb_build_object('party_id', v_party_id, 'changes', '{}'::jsonb)::text, true);

            FOR v_place IN
                SELECT key::uuid AS attendee_id, CASE WHEN jsonb_typeof(value) = 'null' THEN NULL ELSE (value #>> '{}')::uuid END AS place_id
                FROM jsonb_each(COALESCE(v_party->'places', '{}'::jsonb))
            LOOP
                -- #217: deleted_at here, as #237's restrictive policy no longer applies.
                IF NOT EXISTS (SELECT 1 FROM public.attendees
                               WHERE id = v_place.attendee_id AND party_id = v_party_id
                                 AND deleted_at IS NULL) THEN
                    RAISE EXCEPTION USING MESSAGE = 'logistics_attendee_not_in_party', ERRCODE = 'check_violation';
                END IF;

                -- One place per attendee (place_assignments.attendee_id is unique).
                IF v_place.place_id IS NULL THEN
                    DELETE FROM public.place_assignments WHERE attendee_id = v_place.attendee_id;
                ELSE
                    INSERT INTO public.place_assignments (attendee_id, place_id)
                    VALUES (v_place.attendee_id, v_place.place_id)
                    ON CONFLICT (attendee_id) DO UPDATE SET place_id = EXCLUDED.place_id
                    WHERE public.place_assignments.place_id IS DISTINCT FROM EXCLUDED.place_id;
                END IF;
            END LOOP;

            v_place_changes := private.place_changes(v_places_before, private.party_places_snapshot(v_party_id));
            IF v_place_changes IS NOT NULL THEN
                v_pending := current_setting('bedaine.logistics_changes', true)::jsonb;
                PERFORM set_config('bedaine.logistics_changes',
                    jsonb_set(v_pending, '{changes,places}', v_place_changes)::text, true);
            END IF;

            -- The organisers' notes (#227); an absent key keeps them.
            IF v_party ? 'admin_notes' THEN
                INSERT INTO public.party_admin_notes (party_id, notes)
                VALUES (v_party_id, v_party->>'admin_notes')
                ON CONFLICT (party_id) DO UPDATE SET notes = EXCLUDED.notes
                WHERE public.party_admin_notes.notes IS DISTINCT FROM EXCLUDED.notes;
            END IF;

            IF v_party ? 'message_to_participants' THEN
                -- #217: protect_admin_only_party_fields() lets this party's message through.
                PERFORM set_config('bedaine.organiser_party', v_party_id::text, true);
                UPDATE public.user_parties
                SET message_to_participants = v_party->>'message_to_participants'
                WHERE id = v_party_id;
                PERFORM set_config('bedaine.organiser_party', '', true);
            END IF;

            v_pending := NULLIF(current_setting('bedaine.logistics_changes', true), '')::jsonb;
            IF v_pending IS NOT NULL AND v_pending->'changes' <> '{}'::jsonb THEN
                INSERT INTO public.registration_edits (registration_id, edited_by, changes)
                VALUES (v_party_id, auth.uid(), v_pending->'changes');
            END IF;
            PERFORM set_config('bedaine.logistics_changes', '', true);
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT, v_details = PG_EXCEPTION_DETAIL;
            v_failed := v_failed || jsonb_build_array(jsonb_build_object(
                'party_id', COALESCE(v_party_id::text, v_party->>'party_id'),
                'code', v_state,
                'message', v_message,
                'details', NULLIF(v_details, '')
            ));
        END;
    END LOOP;

    RETURN v_failed;
END;
$$;

COMMENT ON FUNCTION public.save_logistics(jsonb) IS
    'Saves the Logistique tab''s pending places, admin notes (party_admin_notes, #227) and messages to participants (#150, #216), each party all or nothing, with one change-history entry per party saved (#188), for Organisateur and above on its event (#217). Returns the parties not saved, with their error.';

-- As in 20261001225145_event_places.sql, except who may read it (#217): Comité and above on the
-- event. SECURITY DEFINER now, since the team's RLS shows the places people sleep in, not the
-- venue's empty ones nor the event's overrides; so it skips removed attendees itself (#237).
CREATE OR REPLACE FUNCTION public.event_places(p_event_id uuid)
RETURNS TABLE (
    place_id uuid,
    label text,
    type text,
    location_id uuid,
    location_name text,
    venue_capacity integer,
    capacity integer,
    is_excluded boolean,
    occupants text[],
    "position" integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_edition_role(p_event_id, 'committee') THEN
        RAISE EXCEPTION USING MESSAGE = 'committee_only', ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT vl.place_id, vl.label, vl.type, vl.location_id, vl.location_name,
           vl.capacity,
           COALESCE(o.capacity, vl.capacity),
           COALESCE(o.is_excluded, false),
           COALESCE(occ.names, '{}'::text[]),
           vl."position"
    FROM public.events e
    CROSS JOIN LATERAL public.venue_layout(e.venue_id) vl
    LEFT JOIN public.event_place_overrides o ON o.event_id = e.id AND o.place_id = vl.place_id
    LEFT JOIN LATERAL (
        SELECT array_agg(a.name ORDER BY a.name) AS names
        FROM public.place_assignments pa
        JOIN public.attendees a ON a.id = pa.attendee_id
        JOIN public.user_parties up ON up.id = a.party_id
        WHERE pa.place_id = vl.place_id AND up.event_id = e.id
          AND a.deleted_at IS NULL  -- #217: #237's restrictive policy no longer applies here
    ) occ ON true
    WHERE e.id = p_event_id AND vl.place_id IS NOT NULL
    ORDER BY vl."position";
END;
$$;

COMMENT ON FUNCTION public.event_places(uuid) IS
    'Every place of an event''s venue as the event sees it (#193): its capacity for the event, excluded or not, who of the event sleeps there. Comité and above on the event (#217).';
