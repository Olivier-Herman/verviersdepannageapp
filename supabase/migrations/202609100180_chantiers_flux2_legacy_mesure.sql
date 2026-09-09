-- Flux 2 — retirer l'ancien écran : instrumentation lancée le 09/09/2026 (Olivier : « vas y »).
-- 30 jours de mesure (fin prévue 09/10/2026), compteurs affichés sur la carte.
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('flux2-legacy', 'Flux 2 — retirer l''ancien flux de clôture', 'cours',
   'Mesure en cours depuis le 09/09 (30 jours, fin le 09/10) : chaque clôture chauffeur dit si elle est passée par le Flux 2 ou par l''ancien écran seul, et si la grille chauffeur × assistance était ouverte (ancien écran + grille ouverte = trou de gating à comprendre). Compteurs ci-dessous, mis à jour en direct. Avant tout retrait, il reste : rapatrier la clôture VD Soft dans le Flux 2, décider pour les appels police, la fiche brouillon SNC/SC et les relivraisons, rétablir les garde-fous (3 photos, signature, paiement). Retrait « risque zéro » impossible tel quel (audit du 09/09).', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Instrumentation lancée : chemin de clôture (Flux 2 / ancien écran) et état de la grille journalisés à chaque clôture ; compteurs sur la carte. Fin de mesure le 09/10/2026.' FROM chantiers WHERE key = 'flux2-legacy';
