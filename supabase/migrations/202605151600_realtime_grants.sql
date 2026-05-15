-- ============================================================
-- 202605151600_realtime_grants
-- ============================================================
-- Donne SELECT a authenticated et anon sur les tables temps reel.
--
-- Probleme : Supabase Realtime verifie les permissions Postgres AVANT de
-- delivrer un event au client. Quand on desactive RLS + GRANT ALL TO
-- service_role uniquement, le client (qui se connecte avec la cle anon)
-- n a pas SELECT → Realtime filtre silencieusement les events et la
-- subscription ne fire jamais malgre payment_derogations dans la publication.
--
-- Solution : GRANT SELECT explicite a authenticated + anon.
-- ============================================================

GRANT SELECT ON public.payment_derogations    TO authenticated, anon;
GRANT SELECT ON public.incoming_missions      TO authenticated, anon;
GRANT SELECT ON public.dispatch_attempts_log  TO authenticated, anon;
