-- #173: creating a registration is logged too, so the admin « Historique des changements » shows
-- when each registration started and who started it.
--
-- save_registration() inserts the empty party, writes its attendees, then updates the party once
-- (status, logistics, transport...), which is when the amount owed and the waitlist flag are set.
-- That final update is the only update of the party while private.is_creating_party() holds, so
-- log_registration_edit() writes the creation entry there, with the attendees already in:
--
--   changes = { "created": { "old": null, "new": {
--     "attendees": [...], "status": ..., "is_waitlisted": ..., "calculated_amount_owed": ... } } }
--
-- Same row shape as an edit ({ field: { old, new } }), so the existing readers (RLS, the member's
-- history) keep working. Authored by auth.uid(): the member, or the admin who created it for them.
-- Existing registrations aren't backfilled.

CREATE OR REPLACE FUNCTION public.log_registration_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    changes_json JSONB := '{}'::JSONB;
    v_attendees_after JSONB;
BEGIN
    IF private.is_creating_party(NEW.id) THEN
        INSERT INTO public.registration_edits (registration_id, edited_by, changes)
        VALUES (NEW.id, auth.uid(), jsonb_build_object('created', jsonb_build_object(
            'old', NULL,
            'new', jsonb_build_object(
                'attendees', private.attendees_snapshot(NEW.id),
                'status', NEW.status,
                'is_waitlisted', NEW.is_waitlisted,
                'calculated_amount_owed', NEW.calculated_amount_owed
            )
        )));
        RETURN NEW;
    END IF;

    -- save_registration() left the attendees as they were before the save.
    IF current_setting('bedaine.saving_party', true) = NEW.id::text THEN
        v_attendees_after := private.attendees_snapshot(NEW.id);
        IF current_setting('bedaine.attendees_before', true)::jsonb IS DISTINCT FROM v_attendees_after THEN
            changes_json = jsonb_set(changes_json, '{attendees}', jsonb_build_object(
                'old', current_setting('bedaine.attendees_before', true)::jsonb,
                'new', v_attendees_after
            ));
        END IF;
    END IF;
    IF OLD.logistics IS DISTINCT FROM NEW.logistics THEN
        changes_json = jsonb_set(changes_json, '{logistics}', jsonb_build_object('old', OLD.logistics, 'new', NEW.logistics));
    END IF;
    IF OLD.transport IS DISTINCT FROM NEW.transport THEN
        changes_json = jsonb_set(changes_json, '{transport}', jsonb_build_object('old', OLD.transport, 'new', NEW.transport));
    END IF;
    IF OLD.music_requests IS DISTINCT FROM NEW.music_requests THEN
        changes_json = jsonb_set(changes_json, '{music_requests}', jsonb_build_object('old', OLD.music_requests, 'new', NEW.music_requests));
    END IF;
    IF OLD.message_to_organizers IS DISTINCT FROM NEW.message_to_organizers THEN
        changes_json = jsonb_set(changes_json, '{message_to_organizers}', jsonb_build_object('old', OLD.message_to_organizers, 'new', NEW.message_to_organizers));
    END IF;
    IF OLD.confirmation_message IS DISTINCT FROM NEW.confirmation_message THEN
        changes_json = jsonb_set(changes_json, '{confirmation_message}', jsonb_build_object('old', OLD.confirmation_message, 'new', NEW.confirmation_message));
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        changes_json = jsonb_set(changes_json, '{status}', jsonb_build_object('old', OLD.status, 'new', NEW.status));
    END IF;
    IF OLD.calculated_amount_owed IS DISTINCT FROM NEW.calculated_amount_owed THEN
        changes_json = jsonb_set(changes_json, '{calculated_amount_owed}', jsonb_build_object('old', OLD.calculated_amount_owed, 'new', NEW.calculated_amount_owed));
    END IF;
    IF OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
        changes_json = jsonb_set(changes_json, '{payment_status}', jsonb_build_object('old', OLD.payment_status, 'new', NEW.payment_status));
    END IF;
    IF OLD.is_waitlisted IS DISTINCT FROM NEW.is_waitlisted THEN
        changes_json = jsonb_set(changes_json, '{is_waitlisted}', jsonb_build_object('old', OLD.is_waitlisted, 'new', NEW.is_waitlisted));
    END IF;
    IF OLD.admin_notes IS DISTINCT FROM NEW.admin_notes THEN
        changes_json = jsonb_set(changes_json, '{admin_notes}', jsonb_build_object('old', OLD.admin_notes, 'new', NEW.admin_notes));
    END IF;

    IF changes_json != '{}'::JSONB THEN
        INSERT INTO public.registration_edits (registration_id, edited_by, changes)
        VALUES (NEW.id, auth.uid(), changes_json);
    END IF;

    RETURN NEW;
END;
$$;
