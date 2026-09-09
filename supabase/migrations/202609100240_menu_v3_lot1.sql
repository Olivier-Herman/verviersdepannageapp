-- Menu v3, lot 1 (Olivier 09/09/2026 : « on y va, on essaie ») :
--  - favoris du menu par utilisateur ;
--  - zone « Maintenant » par rôle = réglages métier (groupe Menu), modifiables dans /admin/settings.
alter table users add column if not exists nav_favorites text[] not null default '{}';
INSERT INTO app_settings (key, value, updated_at) VALUES ('nav_now_dispatcher',  '["/dispatch","/relivraison","/fourriere","/fourriere/saisies","/missions-terminees"]', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('nav_now_facturation', '["/facturation/dossiers","/facturation","/facturation/allianz","/facturation/touring","/admin/amendes"]', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('nav_now_superadmin',  '["/dispatch","/relivraison","/fourriere","/facturation/dossiers","/chantiers"]', now()) ON CONFLICT (key) DO NOTHING;
-- Carte du chantier
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('nav', 'Menu navigable', 'cours',
   'Lot 1 du menu v3 en cours (09/09) : zone « Maintenant » par rôle (réglages métier, groupe Menu), favoris à l''étoile par utilisateur, 3 dernières pages, compteurs sur À relivrer, Réquisitoires à relancer, Sortie AVP, À facturer. Visible superadmin (flag nav_menu_v2), puis pilote Jona, puis tous. Lots 2 (palette ⌘K pages + plaques + fiches) et 3 (barre réduite 64 px, barre du bas mobile) à suivre.', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Lot 1 lancé : zone « Maintenant » par rôle, favoris, récents, compteurs de décision.' FROM chantiers WHERE key = 'nav';
