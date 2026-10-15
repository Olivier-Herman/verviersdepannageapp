-- Mamie Josiane (Olivier 15/10/2026) : blague pour Franck — liste des chauffeurs qui la voient. Vider pour arrêter.
insert into public.app_settings (key, value)
values ('mamie_josiane_users', '["bose4845@gmail.com"]')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
