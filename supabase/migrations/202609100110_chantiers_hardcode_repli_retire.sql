-- Lot A : repli retiré (Olivier 09/09/2026 : « les réglages du lot A sont OK »).
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Lot A — repli retiré : les 20 réglages métier sont semés en base (202609100100) ; un réglage absent ou invalide est désormais une erreur franche (jamais un partenaire 0 ni un mail vide) ; l''écran /admin/settings les rend obligatoires. Audit : app_settings refuse la clé publique (401 en lecture et écriture).' FROM chantiers WHERE key = 'hardcode';
