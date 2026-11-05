-- Bouton Chauffeur / Dispatch (Olivier 05/11/2026) : en Chauffeur, écrans du chauffeur et plus d'alertes du dispatch.
-- Vide = Dispatch (vue habituelle). Les droits ne changent pas. Préversion : Matthieu et Mobi.
alter table users add column if not exists work_mode text check (work_mode in ('chauffeur'));

insert into public.feature_flags (key, mode, label, pilot_user_ids)
values ('work_mode_switch', 'off', 'Bouton Chauffeur / Dispatch (préversion Matthieu et Mobi)', array['de1c6853-fd3c-47fc-b755-82c5b13b0322', '29df3445-f452-4ebc-a7bb-c16a8377289b']::uuid[])
on conflict (key) do nothing;

notify pgrst, 'reload schema';
