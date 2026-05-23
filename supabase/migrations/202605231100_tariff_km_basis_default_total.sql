-- ============================================================
-- 202605231100_tariff_km_basis_default_total
-- ============================================================
-- Inverse le default de km_basis sur source_tariffs : maintenant 'total'
-- (depot -> incident -> destination -> depot) par defaut, le mode 'charged'
-- devient l exception a configurer manuellement.
--
-- Olivier 2026-05-23 : "Base de calcul des km soit par defaut les km totaux.
-- La facturation en km charge est exceptionnelle"
--
-- Impact :
--   - Default colonne : 'charged' -> 'total'
--   - Backfill : tous les tarifs existants en 'charged' passent a 'total'
--     (sauf si l admin avait deja explicitement mis 'total' via la
--     migration 202605181500 pour prive/garage/autre)
--
-- Pour repasser un tarif specifique en 'charged' (ex: cas exceptionnel
-- contractuel) : edition manuelle dans /admin/tarifs ou via SQL.
-- ============================================================

-- 1. Inverser le DEFAULT
ALTER TABLE public.source_tariffs
  ALTER COLUMN km_basis SET DEFAULT 'total';

-- 2. Migrer les rows existantes : tout en 'total' (le mode charged devient
--    une exception explicite que l admin doit configurer manuellement).
UPDATE public.source_tariffs
SET km_basis = 'total'
WHERE km_basis = 'charged';

-- 3. Met a jour le commentaire de la colonne pour refleter le nouveau default
COMMENT ON COLUMN public.source_tariffs.km_basis IS
  'Base km de facturation. Default total (depot->incident->destination->depot). Le mode charged (incident->dest, ex: assurances) est une exception a configurer explicitement.';
