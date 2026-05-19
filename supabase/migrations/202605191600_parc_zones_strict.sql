-- ============================================================
-- 202605191600_parc_zones_strict
-- ============================================================
-- Mode "strict" par zone : refuse les placements au-dela de la
-- capacite de la rangee (pas de +N overflow). Utile pour les zones
-- ou les places sont physiquement contraintes (genre Box).
-- ============================================================

ALTER TABLE public.parc_zones
  ADD COLUMN IF NOT EXISTS strict_capacity BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.parc_zones.strict_capacity IS
  'Si true, refuse tout placement au-dela de la capacite de la rangee. Default false (overflow autorise avec warning).';
