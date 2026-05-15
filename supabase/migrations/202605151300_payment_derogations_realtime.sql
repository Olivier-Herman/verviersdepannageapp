-- ============================================================
-- 202605151300_payment_derogations_realtime
-- ============================================================
-- Active Supabase Realtime sur payment_derogations.
-- Sans cette commande, postgres_changes ne fire pas et la modal cote
-- chauffeur ne s ouvre jamais a la decision dispatcher, et l encart
-- dispatcher ne se synchronise pas entre plusieurs sessions.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'payment_derogations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_derogations';
  END IF;
END $$;
