-- Chantier « Découpe du gardiennage à la levée » : éprouvé à blanc le 09/09/2026
-- (deux dossiers TEST, frais de justice et client), une correction livrée.
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('gard2', 'Découpe du gardiennage à la levée', 'cours',
   'Éprouvé à blanc le 09/09 (dossiers TEST, purgés) : la levée coupe bien en deux groupes. Corrigé : en frais de justice, la période SOUS saisie restait « saisie → autre, à facturer au client » ; elle reste maintenant au tarif saisie, en état de frais. Reste à confirmer sur la première levée réelle après déploiement (les deux levées des 08 et 09/09 sont antérieures à la question du payeur).', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Test à blanc frais de justice / client : découpe OK ; correctif frais de justice (période sous saisie = état de frais, pas facture client).' FROM chantiers WHERE key = 'gard2';
