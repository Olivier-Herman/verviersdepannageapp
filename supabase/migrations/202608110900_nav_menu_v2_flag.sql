-- Flag du chantier « menu navigable » : remplace, pour le superadmin d'abord,
-- le menu de gauche plat par une navigation à 2 niveaux qui glissent (iOS).
--   'off'        → tout le monde garde le menu actuel (prod inchangée)
--   'superadmin' → preview pour les superadmins uniquement
--   'all'        → nouveau menu pour tout le monde
-- La zone opérationnelle à droite n'est PAS concernée : seuls les items du menu changent.
insert into public.feature_flags (key, mode, label)
values ('nav_menu_v2', 'off', 'Menu navigable 2 niveaux (modules → sections)')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
