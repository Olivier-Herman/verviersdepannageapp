-- Chantier « Fourrière — saisies & Parquet » : en ordre (Olivier 09/09/2026).
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('saisies', 'Fourrière — saisies & Parquet', 'fini',
   'Olivier 09/09/2026 : « je pense que c''est en ordre actuellement ». Dernier livré le 09/09 : refus du Parquet plus lu comme un accord, bouton « Renvoyer corrigé ». La découpe à la levée reste suivie sur sa propre carte.', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Terminé — décision Olivier 09/09/2026.' FROM chantiers WHERE key = 'saisies';
