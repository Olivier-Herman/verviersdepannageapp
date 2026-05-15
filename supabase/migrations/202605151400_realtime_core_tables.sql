-- ============================================================
-- 202605151400_realtime_core_tables
-- ============================================================
-- Garantit que les tables principales sont publiees pour Supabase Realtime.
-- Migrations historiques ont parfois oublie ce point ; l app web a deja des
-- subscriptions postgres_changes sur incoming_missions mais l absence de
-- publication explicite expliquerait pourquoi certains UPDATE ne fire pas
-- d evenement realtime.
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'incoming_missions',
    'mission_logs',
    'dispatch_attempts_log'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Realtime active sur public.%', t;
    END IF;
  END LOOP;
END $$;
