-- Décision Olivier 09/09/2026 : les zones de parc Odoo ne sont plus synchronisées
-- depuis que VD Soft est la source de vérité — plus utiles. Le lot B fait vivre les
-- zones uniquement dans parc_zones ; Odoo ne garde que « en cours », « transit »,
-- « terminé ».
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Audit zones de parc : 17 zones code = 17 états Odoo, toutes utilisées ; 3 zones app sans état Odoo (K1, SNC, Verviers) ; synchro Odoo morte (31 états justes sur 179 liés, 355 sans lien). Décision Olivier : on ne resynchronise pas, Odoo abandonne les zones. Lot B : FOURRIERE_ZONES → parc_zones seule. 16 véhicules au parc sans zone à placer.' FROM chantiers WHERE key = 'hardcode';
