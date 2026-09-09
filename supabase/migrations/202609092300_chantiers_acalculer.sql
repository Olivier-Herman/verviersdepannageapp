-- Chantier « À calculer restants » : les trois derniers lus et corrigés le 09/09/2026.
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('acalculer', '« À calculer » restants', 'fini',
   '09/09 après-midi : 3 dossiers sur 53 restaient bloqués après tarification, chacun pour sa raison. 1GJW879 : destination Touring sans coordonnées → géocodée. 1HVS176 : relivraison à 0 km déjà réglée par n° d''accord → « déjà réglé », plus « à calculer ». HSAV6087 : facture partielle classique (devis) dont les postes ne portaient pas le numéro de facture et dont les jours de parc n''étaient pas rattachés au groupe gardiennage → cron sync des devis (94 postes rattrapés), rattachement des jours de parc, référence de brouillon Odoo supprimé décrochée. Règle : lire la raison orange avant de corriger.', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Les 3 derniers « à calculer » lus et corrigés (géocodage, déjà réglé, devis classique) → terminé.' FROM chantiers WHERE key = 'acalculer';
