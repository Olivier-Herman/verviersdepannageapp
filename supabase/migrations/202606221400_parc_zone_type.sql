-- Type de parc (regroupement organisationnel des zones). Olivier 2026-06-22.
-- 3 types : relivraison, accident, saisie. Purement organisationnel (affichage
-- groupé dans l'admin parc) — n'influence PAS l'attribution automatique de zone
-- (qui reste pilotée par le parc par défaut de la source, cf. catalog strict).

ALTER TABLE parc_zones
  ADD COLUMN IF NOT EXISTS zone_type text;

UPDATE parc_zones SET zone_type = 'relivraison' WHERE key IN ('SNC', 'K');
UPDATE parc_zones SET zone_type = 'accident'    WHERE key IN ('A', 'Transit');
UPDATE parc_zones SET zone_type = 'saisie'
  WHERE key IN ('B', 'B*', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'L', 'Box');

NOTIFY pgrst, 'reload schema';
