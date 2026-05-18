-- supabase/migrations/202605181500_tariff_km_basis.sql
--
-- Ajoute le champ km_basis à source_tariffs pour distinguer :
--   - 'charged' : km facturés = incident → destination (assurances : VAB, Touring, etc.)
--   - 'total'   : km facturés = depot → incident → destination → retour depot
--                 (privé, garage, autre — facturation au km parcouru total)
--
-- Default 'charged' qui matche le comportement standard des assurances.
-- Les sources non-assurance (prive, garage, autre) peuvent etre passees a 'total'.

ALTER TABLE source_tariffs
  ADD COLUMN IF NOT EXISTS km_basis TEXT NOT NULL DEFAULT 'charged'
  CHECK (km_basis IN ('charged', 'total'));

COMMENT ON COLUMN source_tariffs.km_basis IS
  'Base km de facturation : charged (incident→dest, assurances) ou total (depot→...→depot, privé/garage)';

-- Backfill : pour les tarifs sur sources "prive", "garage", "autre" → total par default
UPDATE source_tariffs
SET km_basis = 'total'
WHERE source IN ('prive', 'garage', 'autre');
