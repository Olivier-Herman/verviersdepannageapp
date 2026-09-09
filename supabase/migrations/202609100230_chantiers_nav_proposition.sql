-- Menu navigable : proposition v3 remise à Olivier le 09/09/2026 (artefact), en attente de sa décision.
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('nav', 'Menu navigable', 'attente',
   'Proposition v3 remise le 09/09 (artefact « Menu VD Soft v3 ») : zone « Maintenant » par rôle avec compteurs, favoris à l''étoile + pages récentes, palette ⌘K pages + plaques + fiches, badges sur ce qui attend une décision, barre réduite 64 px avec volets, barre du bas sur téléphone. Trois lots (≈ 1 j + ½ j + 1 j) derrière le flag nav_menu_v2, pilote Jona puis tous. Trois décisions attendues : pages « Maintenant » par rôle, favoris par utilisateur et/ou par rôle, calendrier de bascule.', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Proposition v3 remise (artefact « Menu VD Soft v3 », prototype à cliquer). En attente des trois décisions d''Olivier.' FROM chantiers WHERE key = 'nav';
