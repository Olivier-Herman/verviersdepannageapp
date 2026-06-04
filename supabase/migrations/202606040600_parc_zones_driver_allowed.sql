-- src/supabase/migrations/202606040600_parc_zones_driver_allowed.sql
--
-- Olivier 2026-06-04 : autoriser les chauffeurs a deposer dans une zone
-- dynamiquement (au lieu de la const hardcodee DRIVER_ALLOWED_ZONES=['A','Transit']).
--
-- Permet a un admin d ajouter des nouvelles zones et de cocher si les
-- chauffeurs peuvent y deposer ou non, sans toucher au code.

ALTER TABLE public.parc_zones
  ADD COLUMN IF NOT EXISTS driver_allowed BOOLEAN NOT NULL DEFAULT false;

-- Backfill : reproduit le comportement actuel (A + Transit pour les chauffeurs)
UPDATE public.parc_zones SET driver_allowed = true WHERE key IN ('A', 'Transit');

COMMENT ON COLUMN public.parc_zones.driver_allowed IS
  'Si true, les chauffeurs peuvent deposer dans cette zone via /fourriere/plan ou app. '
  'Sinon zone reservee dispatcher/fourriere (J, L, S, etc.). Backfill 2026-06-04 = A + Transit.';

NOTIFY pgrst, 'reload schema';
