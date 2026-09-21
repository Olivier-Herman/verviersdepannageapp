-- supabase/migrations/202609211600_relivraison_mode.sql
--
-- Olivier 21/09/2026 : « pour la grille relivraison, ça dépend de chaque
-- assistance ». La règle « comment on facture une relivraison » sort du code
-- (tag rel_tarif_rem + exceptions) pour vivre sur la ligne relivraison de
-- source_tariffs, par assisteur :
--   rel_mode   all_km      → km aller-retour × prix du km, pas de prise en charge
--              rem_tariff  → même calcul qu'un remorquage (tranches AXA/Ardenne)
--              forfait     → forfait + km inclus + prix du km (calcul standard)
--   rel_depart parc | nearest_depot (dépôt VD le plus proche du lieu d'origine)
-- Les valeurs semées reprennent EXACTEMENT ce que le moteur appliquait : aucun
-- montant ne change tant qu'on ne touche pas à la grille.

ALTER TABLE source_tariffs
  ADD COLUMN IF NOT EXISTS rel_mode   TEXT NULL CHECK (rel_mode IN ('all_km', 'rem_tariff', 'forfait')),
  ADD COLUMN IF NOT EXISTS rel_depart TEXT NOT NULL DEFAULT 'parc' CHECK (rel_depart IN ('parc', 'nearest_depot'));

COMMENT ON COLUMN source_tariffs.rel_mode   IS 'Lignes relivraison : all_km (km A/R × prix km), rem_tariff (calcul remorquage), forfait (forfait + inclus + km)';
COMMENT ON COLUMN source_tariffs.rel_depart IS 'Lignes relivraison : point de départ des km — parc ou dépôt VD le plus proche du lieu d''origine';

-- Lignes relivraison existantes : calcul standard, inchangé.
UPDATE source_tariffs SET rel_mode = 'forfait' WHERE mission_type = 'relivraison' AND rel_mode IS NULL;
UPDATE source_tariffs SET rel_depart = 'nearest_depot' WHERE mission_type = 'relivraison' AND source = 'touring';

-- Sources à forfait sans ligne relivraison : tous les km au prix du km de leur grille remorquage.
INSERT INTO source_tariffs (source, mission_type, pricing_mode, rel_mode, rel_depart, unit_price, km_inclus, km_price, km_basis, is_autofac, effective_from, notes)
SELECT v.source, 'relivraison', 'forfait', 'all_km', 'parc', 0, 0, v.km_price, 'total', false, '2026-09-21',
       'Relivraison : tous les km aller-retour × prix du km, sans prise en charge (Olivier 21/09/2026)'
FROM (VALUES ('mondial', 1.40), ('allianz', 1.40), ('vivium', 1.25), ('tgr_touring', 2.00)) AS v(source, km_price)
WHERE NOT EXISTS (
  SELECT 1 FROM source_tariffs t WHERE t.source = v.source AND t.mission_type = 'relivraison' AND t.effective_to IS NULL
);

-- Grilles par tranches : la relivraison se calcule comme un remorquage.
INSERT INTO source_tariffs (source, mission_type, pricing_mode, rel_mode, rel_depart, unit_price, km_inclus, km_price, km_basis, is_autofac, effective_from, notes)
SELECT v.source, 'relivraison', 'forfait', 'rem_tariff', 'parc', NULL, 0, NULL, 'total', false, '2026-09-21',
       'Relivraison : même calcul qu''un remorquage (tranches de km)'
FROM (VALUES ('axa'), ('ardenne')) AS v(source)
WHERE NOT EXISTS (
  SELECT 1 FROM source_tariffs t WHERE t.source = v.source AND t.mission_type = 'relivraison' AND t.effective_to IS NULL
);

-- Le tag rel_tarif_rem ne sert plus : la ligne relivraison porte la règle.
UPDATE mission_source_catalog SET tags = array_remove(tags, 'rel_tarif_rem') WHERE tags @> ARRAY['rel_tarif_rem'];

NOTIFY pgrst, 'reload schema';
