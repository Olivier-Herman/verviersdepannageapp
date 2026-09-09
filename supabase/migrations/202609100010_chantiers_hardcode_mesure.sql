-- Chantier « Admin sans valeurs en dur » : mesure faite le 09/09/2026 (audit du dépôt, hors /admin).
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('hardcode', 'Admin sans valeurs en dur', 'attente',
   'Mesuré le 09/09 : la norme « rien en dur » n''est pas tenue. Sources : 6 dictionnaires de libellés concurrents + 26 listes dispersées (6 paires dupliquées). Types de mission : 6 dictionnaires. Statuts : 10 dictionnaires de libellés, divergents (« new » = Nouvelle / Reçue / À assigner). Zones de parc : 17 zones + id Odoo codés dans lib/fourriere.ts alors que parc_zones existe. Tarifs : forfait 165,29 en 3 copies, 20 €/jour en 6 endroits dont le site public et le prompt IA. Partenaires Odoo (67, 79, 83, 56…) et boîtes SPF Justice / Domaine en dur. Top 10 chiffré : 2 S, 5 M, 3 L. En attente de la décision : par quoi commencer.', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Mesure faite (audit 09/09) : 6 familles, top 10 à sortir chiffré S/M/L. Passe en attente d''une décision.' FROM chantiers WHERE key = 'hardcode';
