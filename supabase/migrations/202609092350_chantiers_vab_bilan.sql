-- Chantier « VAB — fiabilisation » : bilan des clôtures autonomes (09/09/2026).
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('vab', 'VAB — fiabilisation', 'cours',
   'Bilan 31/08 → 09/09 : 23 missions VAB terminées, 20 clôturées seules chez VAB (souvent après 1-3 reprises : compte occupé, écran des codes). Depuis le 03/09 : 100 % clôturées, hors une fiche requalifiée Siabis couvert (VAB clôture lui-même, filet arrêté = correct). 3 fiches anciennes jamais clôturées par le filet : #10128454 (31/08), #10128980 (31/08, VAB refuse la signature), #10130057 (01/09, aucune tentative, autofacturée 2026/09/012) — à vérifier à la main sur le portail VAB.', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Bilan clôtures autonomes : 20/23 depuis le 31/08, 100 % depuis le 03/09 ; 3 anciennes à vérifier sur le portail VAB.' FROM chantiers WHERE key = 'vab';
