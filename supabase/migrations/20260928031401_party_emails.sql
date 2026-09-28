-- Issue #12 / ADR 0016: transactional emails for registration lifecycle changes.
--
-- A change to user_parties that can make an email due asks the Edge Function send-party-email,
-- through pg_net, to look at that party. The request carries only the party id: the function
-- decides which emails are due from the party's current state and email_log, so a duplicate or
-- unexpected call can never send a wrong or repeated email. That is also why the function needs
-- no shared secret.
--
-- The function URL is per environment, so it lives in private.settings, not in this file:
--   - local: supabase/seed.sql points it at the local edge runtime;
--   - production: CI writes it after deploying the function (.github/workflows/deploy.yml);
--   - Preview loads the same seed; that host only exists locally, so the request fails there;
--   - anywhere it is unset, the trigger does nothing.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------------------------
-- Per-environment settings, out of reach of the API (the private schema is not exposed).

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE private.settings (
    "key" text PRIMARY KEY,
    "value" text NOT NULL
);

COMMENT ON TABLE private.settings IS
  'Per-environment configuration read by triggers. email_function_url: where send-party-email is served; unset means no email is requested.';

-- ---------------------------------------------------------------------------------------------
-- One row per (party, email). The unique key is what makes sending idempotent: the function
-- claims a row before sending, and a template already claimed is never sent again, whatever
-- the outcome. Resend's free plan keeps its own logs for 30 days only; this is the durable record.

CREATE TABLE public.email_log (
    "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "party_id" uuid NOT NULL REFERENCES public.user_parties(id) ON DELETE CASCADE,
    "template" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "recipient" text,
    "resend_id" text,
    "error" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT email_log_party_template_key UNIQUE ("party_id", "template"),
    CONSTRAINT email_log_template_check
      CHECK ("template" IN ('registration', 'waitlist', 'promotion', 'payment', 'accommodation')),
    CONSTRAINT email_log_status_check
      CHECK ("status" IN ('pending', 'sent', 'dry_run', 'failed', 'backfilled'))
);

COMMENT ON TABLE public.email_log IS
  'Transactional emails per party (ADR 0016). status: pending = claimed, being sent; sent; dry_run = no RESEND_API_KEY in this environment, logged instead; failed = Resend refused, not retried; backfilled = state predating this table, never emailed.';

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Email Log: Admins can read" ON public.email_log
  FOR SELECT TO authenticated USING (public.is_admin());

GRANT SELECT ON TABLE public.email_log TO authenticated;
-- The Edge Function reads parties and writes the log with the service role (RLS bypassed).
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_log TO service_role;
GRANT SELECT ON TABLE public.user_parties, public.events, public.profiles TO service_role;

-- ---------------------------------------------------------------------------------------------
-- Existing registrations predate emails: record their current state as already handled, so the
-- first change after this migration doesn't email people about things that happened weeks ago.
-- Must stay in step with dueTemplates() in supabase/functions/send-party-email/emails.ts.

CREATE FUNCTION private.has_assigned_bed(attendees jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_path_exists(attendees, '$[*] ? (@.assigned_bed like_regex "\\S")'), false);
$$;

-- The update trigger's WHEN clause calls this as whoever made the change (a member or an admin),
-- so they need to reach it. The settings table stays ungranted.
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_assigned_bed(jsonb) TO authenticated, service_role;

INSERT INTO public.email_log ("party_id", "template", "status")
SELECT p.id, t.template, 'backfilled'
FROM public.user_parties p
CROSS JOIN LATERAL (VALUES
    ('registration', NOT p.is_waitlisted),
    ('waitlist', p.is_waitlisted),
    ('payment', p.payment_status = 'paid'),
    ('accommodation', private.has_assigned_bed(p.attendees))
) AS t(template, applies)
WHERE t.applies;

-- ---------------------------------------------------------------------------------------------
-- The request. AFTER triggers, and pg_net only sends once the transaction commits, so the
-- function always reads the committed row. A failed request never blocks or rolls back the write.

CREATE FUNCTION private.request_party_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_url text;
BEGIN
    SELECT "value" INTO v_url FROM private.settings WHERE "key" = 'email_function_url';
    IF v_url IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM net.http_post(
        url := v_url,
        body := jsonb_build_object('party_id', NEW.id),
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 10000
    );
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.request_party_email() FROM PUBLIC;

CREATE TRIGGER trg_request_party_email_on_insert
AFTER INSERT ON public.user_parties
FOR EACH ROW
EXECUTE FUNCTION private.request_party_email();

-- Only the changes an email depends on. Transport, dietary notes and later bed reshuffles never
-- call the function, which keeps us far from the Resend free plan's 100 emails/day.
CREATE TRIGGER trg_request_party_email_on_update
AFTER UPDATE ON public.user_parties
FOR EACH ROW
WHEN (
    OLD.is_waitlisted IS DISTINCT FROM NEW.is_waitlisted
    OR OLD.payment_status IS DISTINCT FROM NEW.payment_status
    OR OLD.status IS DISTINCT FROM NEW.status
    OR (private.has_assigned_bed(NEW.attendees) AND NOT private.has_assigned_bed(OLD.attendees))
)
EXECUTE FUNCTION private.request_party_email();
