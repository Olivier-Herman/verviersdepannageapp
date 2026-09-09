-- Chantiers : les deux migrations en attente sont passées en base le 09/09/2026
-- (session locale, une par une via l'API de gestion, historique réparé).
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('mig-payer', 'Migration : question du payeur à la levée', 'fini',
   'Appliquée le 09/09/2026 : colonne incoming_missions.levee_saisie_payer (frais_justice | client) en place.', now(), 'Claude'),
  ('mig-kaze',  'Migration : coordonnées Kaze', 'fini',
   'Appliquée le 09/09/2026 : 0 fiche rattrapée — les 397 fiches Kaze qui avaient une position dans parsed_data avaient déjà leurs coordonnées ; les autres n''ont jamais reçu de position de Kaze (rien à récupérer). L''app chauffeur géocode désormais avant d''ouvrir la navigation.', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';

INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Migration appliquée en base le 09/09/2026 → terminé.' FROM chantiers WHERE key IN ('mig-payer', 'mig-kaze');
