-- Chantier « Refonte du flux sur place » : terminé (Olivier 09/09/2026).
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('onsite', 'Refonte du flux sur place', 'fini',
   'Écran « Qu''est-ce qu''on fait ? » ouvert à tous les chauffeurs (drapeau driver_onsite_v2 = all). Olivier 09/09/2026 : « pour moi est terminé ».', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Terminé — décision Olivier 09/09/2026 (drapeau déjà ouvert à tous).' FROM chantiers WHERE key = 'onsite';
