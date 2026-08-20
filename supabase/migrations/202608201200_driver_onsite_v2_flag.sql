-- Flag du chantier « refonte flux sur place chauffeur » (écran « Qu'est-ce
-- qu'on fait ? » + choix scénario + type de mission + encaissement couplé).
--   'off'        → tout le monde garde l'écran actuel (prod inchangée)
--   'superadmin' → preview pour les superadmins uniquement
--   'all'        → nouveau flux pour tout le monde
insert into public.feature_flags (key, mode, label)
values ('driver_onsite_v2', 'off', 'Écran « Qu''est-ce qu''on fait ? » sur place (scénario + type + encaissement)')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
