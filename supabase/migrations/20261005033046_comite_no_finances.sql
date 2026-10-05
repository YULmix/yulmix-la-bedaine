-- #290 (ADR 0026, amending ADR 0023): Comité doesn't see finances. "Finances" are a party's
-- amounts and payment status: calculated_amount_owed, locked_selling_price_whole_event,
-- locked_ratio_main_whole and payment_status, and what derives from them (paid counts, totals, the
-- amounts in the change history). Organisateur and above, and admins, keep everything.
--
--   * user_parties and registration_edits: the edition team's read becomes Organisateur and above.
--     Own rows and admins are unchanged, so a Comité member still reads their own registration in
--     full.
--   * edition_parties(event): Comité and above (committee_only otherwise) read an edition's
--     parties through it, as the admin list shows them (attendees in order with their place, the
--     registrant's profile, the organisers' notes), without the four money columns. SECURITY
--     DEFINER, so it filters removed attendees itself (#237's restrictive policy doesn't apply),
--     and it leaves out a deleted account's cancelled registrations like the admin list (#36).
--   * What Comité still reads directly, as before: attendees (and through them place_assignments,
--     places, locations), attendee_places, party_admin_notes, the registrants' profiles. Those
--     policies (and attendee_places) read user_parties under the caller's RLS, which no longer shows
--     Comité its edition's parties, so they now ask private.edition_team_reads_party() /
--     private.party_event_id() instead (SECURITY DEFINER). None of them carries an amount or a
--     payment status. user_event_history (amounts, payment status) reads user_parties as the
--     caller, so Comité sees only its own rows there.
--
-- Accepted trade-off (organiser, 2026-10-04): realtime follows RLS, so Comité's admin screens no
-- longer live-refresh; they reload on navigation and on retry.
--
-- Redefined here, each copied from its latest definition on main:
--   attendee_places (view)                           20261001043009_galleries.sql
--   "User Parties: Edition team reads its edition"   20261004124226_edition_roles.sql (#217)
--   "Registration Edits: Edition team reads its edition's history"   same
--   "Party Admin Notes: Edition team reads its edition's"            same

-- ---------------------------------------------------------------------------------------------
-- Helpers that read a party whatever the caller's RLS on user_parties says.

-- Whether the caller is Comité or above on the party's edition (admins included).
CREATE FUNCTION private.edition_team_reads_party(p_party_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_parties up
                   WHERE up.id = p_party_id AND public.has_edition_role(up.event_id, 'committee'));
$$;

COMMENT ON FUNCTION private.edition_team_reads_party(uuid) IS
    'Whether the caller is Comité or above on the party''s edition (#290): the edition team''s reads of attendees and notes, now that Comité doesn''t read user_parties.';

-- A party's event. Only attendee_places calls it, on attendee rows the caller's RLS already shows.
CREATE FUNCTION private.party_event_id(p_party_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT up.event_id FROM public.user_parties up WHERE up.id = p_party_id;
$$;

COMMENT ON FUNCTION private.party_event_id(uuid) IS
    'A party''s event, whatever the caller''s RLS on user_parties (#290). For attendee_places, which reads attendees under the caller''s RLS.';

REVOKE ALL ON FUNCTION private.edition_team_reads_party(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.party_event_id(uuid) FROM PUBLIC;
-- service_role too: functions in private get no default grant, and the service role reads
-- attendee_places (send-party-email embeds it), whose security_invoker body calls party_event_id().
GRANT EXECUTE ON FUNCTION private.edition_team_reads_party(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.party_event_id(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The money: Organisateur and above.

DROP POLICY "User Parties: Edition team reads its edition" ON public.user_parties;
CREATE POLICY "User Parties: Organisateur and above read their edition" ON public.user_parties
    FOR SELECT TO authenticated
    USING (public.has_edition_role(event_id, 'organiser'));

-- The change history logs the amounts and the payment status.
DROP POLICY "Registration Edits: Edition team reads its edition's history" ON public.registration_edits;
CREATE POLICY "Registration Edits: Organisateur and above read the history" ON public.registration_edits
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_parties up
                   WHERE up.id = registration_id AND public.has_edition_role(up.event_id, 'organiser')));

-- ---------------------------------------------------------------------------------------------
-- What the edition team (Comité and above) still reads directly.

-- Next to "Attendees: read with their party" (own party, admin, Organisateur and above through
-- user_parties). #237's restrictive policy still hides removed attendees. The uncorrelated
-- EXISTS on one's own edition_roles rows runs once per query (an InitPlan), so a member or an
-- admin (who hold none) never pays the per-row definer call.
CREATE POLICY "Attendees: Edition team reads its edition's" ON public.attendees
    FOR SELECT TO authenticated
    USING ((SELECT EXISTS (SELECT 1 FROM public.edition_roles r WHERE r.user_id = (SELECT auth.uid())))
           AND private.edition_team_reads_party(party_id));

DROP POLICY "Party Admin Notes: Edition team reads its edition's" ON public.party_admin_notes;
CREATE POLICY "Party Admin Notes: Edition team reads its edition's" ON public.party_admin_notes
    FOR SELECT TO authenticated
    USING (private.edition_team_reads_party(party_id));

-- As in 20261001043009_galleries.sql, except the party's event: it came from a join on
-- user_parties under the caller's RLS, which no longer shows Comité its edition's parties. The rows
-- are still the attendees (and their place_assignments) the caller's RLS shows; the inner join
-- keeps them, since every attendee has a party. Same columns, so CREATE OR REPLACE keeps the grants.
CREATE OR REPLACE VIEW public.attendee_places WITH (security_invoker = true) AS
SELECT pa.attendee_id,
       a.party_id,
       a.name AS attendee_name,
       up.event_id,
       l.id AS location_id,
       l.name AS location_name,
       pl.id AS place_id,
       pl.label AS place_label,
       pl.type AS place_type,
       l.name || ' · ' || pl.label AS bed_label
FROM public.place_assignments pa
JOIN public.attendees a ON a.id = pa.attendee_id
JOIN LATERAL (SELECT private.party_event_id(a.party_id) AS event_id) up ON up.event_id IS NOT NULL
JOIN public.places pl ON pl.id = pa.place_id
JOIN public.locations l ON l.id = pl.location_id;

-- ---------------------------------------------------------------------------------------------
-- The edition's parties without the money, for Comité (and above).

CREATE FUNCTION public.edition_parties(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.has_edition_role(p_event_id, 'committee') THEN
        RAISE EXCEPTION USING MESSAGE = 'committee_only', ERRCODE = '42501';
    END IF;

    -- Named columns, never the row: a money column (or any private one) added to user_parties
    -- later stays out. Left out: the four money columns, and confirmation_message (legacy, shown
    -- nowhere in the admin).
    RETURN COALESCE((
        SELECT jsonb_agg(
                   jsonb_build_object(
                       'id', up.id,
                       'user_id', up.user_id,
                       'event_id', up.event_id,
                       'status', up.status,
                       'is_waitlisted', up.is_waitlisted,
                       'logistics', up.logistics,
                       'transport', up.transport,
                       'music_requests', up.music_requests,
                       'message_to_organizers', up.message_to_organizers,
                       'message_to_participants', up.message_to_participants,
                       'created_at', up.created_at,
                       'last_edited_at', up.last_edited_at,
                       'edit_count', up.edit_count,
                       'attendees', COALESCE(att.list, '[]'::jsonb),
                       'profiles', jsonb_build_object(
                           'id', p.id,
                           'email', p.email,
                           'full_name', p.full_name,
                           'is_admin', p.is_admin,
                           'created_at', p.created_at,
                           'deleted_at', p.deleted_at),
                       'admin_notes', n.notes)
                   ORDER BY up.created_at, up.id)
        FROM public.user_parties up
        JOIN public.profiles p ON p.id = up.user_id
        LEFT JOIN public.party_admin_notes n ON n.party_id = up.id
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(
                       to_jsonb(a) || jsonb_build_object('place', CASE WHEN pl.id IS NULL THEN NULL ELSE
                           jsonb_build_object(
                               'place_id', pl.id,
                               'bed_label', l.name || ' · ' || pl.label,
                               'place_label', pl.label,
                               'location_id', l.id,
                               'location_name', l.name) END)
                       ORDER BY a."position") AS list
            FROM public.attendees a
            LEFT JOIN public.place_assignments pa ON pa.attendee_id = a.id
            LEFT JOIN public.places pl ON pl.id = pa.place_id
            LEFT JOIN public.locations l ON l.id = pl.location_id
            WHERE a.party_id = up.id
              AND a.deleted_at IS NULL  -- #237's restrictive policy doesn't apply here
        ) att ON true
        WHERE up.event_id = p_event_id
          -- A deleted account's cancelled registrations: no longer a member of this edition (#36).
          AND NOT (p.deleted_at IS NOT NULL AND up.status = 'cancelled')
    ), '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.edition_parties(uuid) IS
    'An edition''s parties as the admin list shows them (attendees with their place, the registrant''s profile, the organisers'' notes as admin_notes), without amounts nor payment status: Comité and above on the event (#290, ADR 0026).';

REVOKE ALL ON FUNCTION public.edition_parties(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edition_parties(uuid) TO authenticated;
