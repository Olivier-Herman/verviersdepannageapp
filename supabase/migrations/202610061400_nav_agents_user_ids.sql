-- Raccourci « Propositions des agents » : comptes d'Olivier seulement (06/10/2026).
insert into app_settings (key, value) values
  ('nav_agents_user_ids', '["29df3445-f452-4ebc-a7bb-c16a8377289b","fd345b74-539b-466b-9b64-19d168f561d4"]')
on conflict (key) do nothing;
notify pgrst, 'reload schema';
