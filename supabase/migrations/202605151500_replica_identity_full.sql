-- ============================================================
-- 202605151500_replica_identity_full
-- ============================================================
-- Active REPLICA IDENTITY FULL sur les tables ou on souscrit a des
-- postgres_changes avec un FILTRE sur une colonne != PK.
--
-- Sans FULL, l UPDATE event Supabase Realtime n inclut pas la valeur des
-- colonnes non-PK dans la ligne OLD → le filtre cote client ne matche pas
-- toujours, et certains UPDATE ne declenchent pas l event.
--
-- Cas concret : payment_derogations filtre sur mission_id (UUID, pas PK).
-- Sans FULL, la modal cote chauffeur ne s ouvre pas a la decision dispatcher.
-- ============================================================

ALTER TABLE public.payment_derogations REPLICA IDENTITY FULL;
ALTER TABLE public.incoming_missions   REPLICA IDENTITY FULL;
ALTER TABLE public.dispatch_attempts_log REPLICA IDENTITY FULL;
