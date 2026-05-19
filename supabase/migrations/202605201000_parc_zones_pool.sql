-- ============================================================
-- 202605201000_parc_zones_pool
-- ============================================================
-- Zones "Bordel" : capacite globale, pas de rangees ni d emplacement.
-- Les vehicules sont attaches a la zone mais sans row/slot. Cas d usage :
-- zone fourre-tout, places non structurees, debordement temporaire.
--
-- is_pool       : flag boolean. False par defaut = comportement classique
--                 (grille structuree avec parc_rows).
-- pool_capacity : capacite totale visee (nullable = illimite). Le placement
--                 au dela est tolere (cf. overflow flexible des grilles).
-- ============================================================

ALTER TABLE public.parc_zones
  ADD COLUMN IF NOT EXISTS is_pool        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pool_capacity  INTEGER;

COMMENT ON COLUMN public.parc_zones.is_pool       IS 'Zone fourre-tout (Bordel) : pas de rangees ni emplacements, juste une capacite globale.';
COMMENT ON COLUMN public.parc_zones.pool_capacity IS 'Capacite cible pour les zones pool. Null = illimite. Overflow tolere avec warning visuel.';
