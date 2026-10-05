-- Boîte des échanges avec le cabinet comptable (Olivier 05/10/2026) : réglages.
insert into app_settings (key, value) values
  ('agents_boite_comptable',  '"mobi@verviersdepannage.be"'),
  ('agents_domaine_comptable','"thg.be"'),
  ('agents_dossier_comptable','"Comptable THG"')
on conflict (key) do nothing;
notify pgrst, 'reload schema';
