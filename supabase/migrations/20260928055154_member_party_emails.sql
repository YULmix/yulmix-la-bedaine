-- #93: a member sees which emails went out for their own party.
--
-- email_log stays admin-only. RLS can't hide columns from one authenticated role, and a member
-- has no business reading error, resend_id or recipient. This function is the member's only view
-- of the log: template, date and a simplified status, for a party the caller owns.
--
--   * sent -> 'sent'; failed -> 'not_sent' (the member is told to contact an organiser).
--   * pending, dry_run and backfilled are left out: no email went out for them, so showing one
--     would claim something false.
--   * Someone else's party, or a deleted account, gets no rows (not an error).

CREATE FUNCTION public.my_party_emails(p_party_id uuid)
RETURNS TABLE ("template" text, "sent_at" timestamptz, "status" text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT l.template,
           l.updated_at,
           CASE WHEN l.status = 'sent' THEN 'sent' ELSE 'not_sent' END
    FROM public.email_log l
    JOIN public.user_parties p ON p.id = l.party_id
    WHERE l.party_id = p_party_id
      AND p.user_id = auth.uid()
      AND l.status IN ('sent', 'failed')
      AND public.is_account_active()
    ORDER BY l.updated_at DESC;
$$;

ALTER FUNCTION public.my_party_emails(uuid) OWNER TO "postgres";

COMMENT ON FUNCTION public.my_party_emails(uuid) IS
    'The caller''s own party emails (#93): template, sent_at, status sent|not_sent. Hides pending, dry_run and backfilled rows, and every other column of email_log.';

REVOKE ALL ON FUNCTION public.my_party_emails(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_party_emails(uuid) TO authenticated;
