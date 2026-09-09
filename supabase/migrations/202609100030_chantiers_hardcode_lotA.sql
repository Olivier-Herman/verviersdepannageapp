-- Chantier « Admin sans valeurs en dur » : lot A livré (09/09/2026 soir).
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('hardcode', 'Admin sans valeurs en dur', 'cours',
   'Lot A livré le 09/09 : grille de restitution fourrière lue dans les tarifs (plus de copie écran/serveur), registre des réglages métier dans /admin/settings (partenaires et journaux Odoo, boîtes SPF Justice / Domaine / avis de paiement / rejets, forfait parc accident), garde-fou au build qui refuse tout nouvel identifiant Odoo, montant ou boîte mail en dur. Repli = valeur historique, vérifié identique. Reste : lot B (zones de parc, libellés de sources, listes de sources en cases à cocher, dépôts par drapeau, tarifs affichés lus dans la grille) et lot C (types et statuts, avec le relooking).', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Lot A livré : grille de restitution dans les tarifs, réglages métier (Odoo, boîtes mail, forfait parc), garde-fou prebuild. Lots B et C à suivre.' FROM chantiers WHERE key = 'hardcode';
