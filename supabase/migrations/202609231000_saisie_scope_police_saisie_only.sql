-- Olivier 23/09/2026 : « seule la source Appel Police – Saisie peut utiliser le
-- chemin des états de frais ». legacy_odoo portait aussi le tag saisie_scope :
-- une fiche migrée non qualifiée pouvait entrer dans le circuit Parquet. Elle
-- doit d'abord être requalifiée en police_saisie (cf. HSNA990).
UPDATE mission_source_catalog SET tags = array_remove(tags, 'saisie_scope')
 WHERE key <> 'police_saisie' AND tags @> ARRAY['saisie_scope'];
NOTIFY pgrst, 'reload schema';
