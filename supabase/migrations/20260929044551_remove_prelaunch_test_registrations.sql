-- Before the Bédaine 2026 launch (2026-09-29): remove the registrations organisers and testers
-- made in production while trying the app, so the event opens empty. Data only, no schema change.
--
-- The five parties are listed by id, not "every party of the event": registration is already
-- open, so anyone who registers for real before this runs keeps their registration. On any other
-- database (local, CI, preview) the ids don't exist and this does nothing.
--
-- Deleting a party cascades to its attendees, place_assignments, email_log and
-- registration_edits rows. No trigger sends an email or promotes the waitlist on a delete. The
-- event, its budget and its locations, and every account and profile, are left as they are.

DO $$
DECLARE
    v_deleted integer;
BEGIN
    DELETE FROM public.user_parties
    WHERE id IN (
        'eac33fdf-bbf2-4ac7-8520-a5c095870990',
        '177eaa31-b45f-481b-bbf0-d0d16c52e059',
        '67c53972-82ec-42c7-96bd-349a6e914a71',
        'fd45b6a7-94b5-48ff-8271-857147792cc1',
        '3101e7d6-701b-4ff2-8293-2410a980d246'
    )
    AND event_id = '1f7127f9-ac51-481a-91f8-b887f2e1ae6e';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    -- In production all five must go, or none: a partial match means the data isn't what was
    -- reviewed, and the migration (with the backup taken just before it) should stop there.
    IF EXISTS (SELECT 1 FROM public.events WHERE id = '1f7127f9-ac51-481a-91f8-b887f2e1ae6e')
       AND v_deleted <> 5 THEN
        RAISE EXCEPTION 'remove_prelaunch_test_registrations: expected 5 test parties, found %', v_deleted;
    END IF;
END;
$$;
