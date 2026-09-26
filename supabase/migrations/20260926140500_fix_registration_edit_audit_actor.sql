-- Fixes #44 (audit log misattribution): log_registration_edit() recorded edited_by = NEW.user_id,
-- i.e. the owner of the row being edited, even when the actual write was made by an admin acting
-- on someone else's behalf (RLS lets admins update any user_parties row). That means a god-mode
-- admin edit is indistinguishable in the audit trail from the member editing their own
-- registration.
--
-- Fix: record the actual authenticated actor performing the write (auth.uid()) instead of the
-- row's owner.

CREATE OR REPLACE FUNCTION "public"."log_registration_edit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    changes_json JSONB := '{}'::JSONB;
BEGIN
    IF OLD.attendees IS DISTINCT FROM NEW.attendees THEN
        changes_json = jsonb_set(changes_json, '{attendees}', jsonb_build_object('old', OLD.attendees, 'new', NEW.attendees));
    END IF;
    IF OLD.counts IS DISTINCT FROM NEW.counts THEN
        changes_json = jsonb_set(changes_json, '{counts}', jsonb_build_object('old', OLD.counts, 'new', NEW.counts));
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
