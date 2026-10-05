-- #296: the supabase_realtime publication was empty (locally, Preview and production), so the
-- admin parties store's postgres_changes channel on user_parties subscribed but never fired.
--
-- Realtime delivers a change only to subscribers who may SELECT the row, by the table's SELECT
-- policies (#290: Organisateur and above read their edition's parties, a member their own,
-- Comité none: its parties and their finances come through edition_parties()). Default replica
-- identity is enough: the store reloads on any event and never reads the payload.
-- Guarded, so it doesn't fail where the table is already a member.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_parties'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_parties;
  END IF;
END $$;
