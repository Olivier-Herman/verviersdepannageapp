-- supabase/migrations/202609211700_relivraison_after_included.sql
--
-- Olivier 21/09/2026 : « Touring et VAB : on fait le total des km parcourus sur
-- tous les groupes, forfait + km − km inclus. Ethias, Kaze, P&V et Vivium :
-- les groupes sont séparés, prise en charge sur la première mission, ensuite
-- chaque relivraison à tous ses kilomètres. Mondial et Allianz comme Ethias. »
--   after_included → la relivraison facture ses km au-delà des km inclus que le
--                    remorquage du dossier n'a pas consommés (un seul forfait,
--                    un seul lot de km inclus par dossier)

ALTER TABLE source_tariffs DROP CONSTRAINT IF EXISTS source_tariffs_rel_mode_check;
ALTER TABLE source_tariffs ADD CONSTRAINT source_tariffs_rel_mode_check
  CHECK (rel_mode IN ('all_km', 'after_included', 'rem_tariff', 'forfait'));
COMMENT ON COLUMN source_tariffs.rel_mode IS 'Lignes relivraison : all_km (km A/R × prix km), after_included (km au-delà des inclus restants du dossier), rem_tariff (calcul remorquage), forfait (forfait + inclus + km)';

UPDATE source_tariffs SET rel_mode = 'after_included'
 WHERE mission_type = 'relivraison' AND effective_to IS NULL AND source IN ('touring', 'vab');

UPDATE source_tariffs SET rel_mode = 'all_km'
 WHERE mission_type = 'relivraison' AND effective_to IS NULL AND source IN ('ethias', 'kaze', 'pv_assistance', 'vivium', 'mondial', 'allianz');

NOTIFY pgrst, 'reload schema';
