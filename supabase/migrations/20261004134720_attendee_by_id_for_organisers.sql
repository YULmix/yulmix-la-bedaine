-- #236 with #217: the budget is edited by an edition's Organisateurs and above, who must read the
-- name of a removed payer too. attendee_by_id() was admin-only (#237); it now also answers an
-- Organisateur (or admin) of the attendee's own edition. Members and Comité stay refused, and so
-- does an Organisateur of another edition (admin_only, whether or not the id exists, so it
-- doesn't tell them which ids exist).
--
-- Body copied from its latest definition, 20261003222508_soft_delete_attendees.sql; the only
-- change is the authorisation. CREATE OR REPLACE keeps the owner and the grants.

CREATE OR REPLACE FUNCTION public.attendee_by_id(p_attendee_id uuid)
RETURNS TABLE (id uuid, party_id uuid, name text, deleted_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_event_id uuid;
BEGIN
    SELECT up.event_id INTO v_event_id
    FROM public.attendees a
    JOIN public.user_parties up ON up.id = a.party_id
    WHERE a.id = p_attendee_id;

    IF NOT (public.is_admin()
            OR (v_event_id IS NOT NULL AND public.has_edition_role(v_event_id, 'organiser'))) THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_only', ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT a.id, a.party_id, a.name, a.deleted_at
    FROM public.attendees a
    WHERE a.id = p_attendee_id;
END;
$$;
