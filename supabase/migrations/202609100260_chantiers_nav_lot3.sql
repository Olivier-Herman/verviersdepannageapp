-- Menu v3 : lots 1, 2 et 3 livrés le 09/09/2026, en pilote (superadmins + Jona).
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('nav', 'Menu navigable', 'cours',
   'Menu v3 en pilote depuis le 09/09 (superadmins + Jona, flag nav_menu_v2). Livré : zone « Maintenant » par rôle (réglages métier, groupe Menu), favoris à l''étoile, pages récentes, compteurs de décision (lot 1) ; palette ⌘K pages + plaques + fiches, champ du menu = même palette (lot 2) ; barre réduite 64 px avec pictogrammes, compteurs et volets, barre du bas sur téléphone avec les 4 pages du rôle (lot 3). Prochaine étape : retour de Jona, puis bascule pour tous (mode all du flag).', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Lot 3 livré : barre réduite 64 px avec volets, barre du bas sur téléphone. Menu v3 complet en pilote (superadmins + Jona).' FROM chantiers WHERE key = 'nav';
