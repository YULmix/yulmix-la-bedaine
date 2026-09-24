-- Idempotent follow-up to migrate_status_payment_status_to_english.sql.
--
-- Why this exists: Postgres re-validates every CHECK constraint against the
-- *whole* row on every UPDATE, not just the columns being written. If even
-- one user_parties row still carries a pre-migration French value in status
-- or payment_status, ANY future update to that row fails with "violates
-- check constraint user_parties_payment_status_check" (or _status_check) —
-- including updates that never touch that column at all. That's what
-- produced this error against a real per-attendee attendees-only update.
--
-- Safe to run multiple times: constraints are dropped/re-added with
-- IF EXISTS, and each UPDATE only touches rows that don't already have a
-- valid value, so a second run is a no-op if the first one succeeded.
--
-- If any row has a value outside the known French mapping, this refuses to
-- re-add the constraint and raises an exception naming the offending rows
-- instead of guessing a mapping — run the SELECT below first if you want to
-- see them ahead of time:
--   SELECT id, status, payment_status FROM public.user_parties
--   WHERE status NOT IN ('registered','pending','cancelled')
--      OR payment_status NOT IN ('unpaid','paid');

ALTER TABLE public.user_parties DROP CONSTRAINT IF EXISTS user_parties_status_check;
ALTER TABLE public.user_parties DROP CONSTRAINT IF EXISTS user_parties_payment_status_check;

UPDATE public.user_parties SET status = 'registered' WHERE status = 'Enregistré';
UPDATE public.user_parties SET status = 'pending' WHERE status = 'En attente';
UPDATE public.user_parties SET status = 'cancelled' WHERE status = 'Annulé';
UPDATE public.user_parties SET payment_status = 'paid' WHERE payment_status = 'Payé';
UPDATE public.user_parties SET payment_status = 'unpaid' WHERE payment_status = 'Impayé';

DO $$
DECLARE
    bad_count INT;
BEGIN
    SELECT count(*) INTO bad_count
    FROM public.user_parties
    WHERE (status IS NOT NULL AND status NOT IN ('registered', 'pending', 'cancelled'))
       OR (payment_status IS NOT NULL AND payment_status NOT IN ('unpaid', 'paid'));

    IF bad_count > 0 THEN
        RAISE EXCEPTION 'Refusing to re-add the CHECK constraints: % row(s) still have a status/payment_status value outside the known set. Run: SELECT id, status, payment_status FROM public.user_parties WHERE status NOT IN (''registered'',''pending'',''cancelled'') OR payment_status NOT IN (''unpaid'',''paid'');', bad_count;
    END IF;
END $$;

ALTER TABLE public.user_parties ADD CONSTRAINT user_parties_status_check
  CHECK (status IN ('registered', 'pending', 'cancelled'));
ALTER TABLE public.user_parties ADD CONSTRAINT user_parties_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid'));
