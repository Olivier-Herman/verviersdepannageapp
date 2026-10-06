-- Plateformes d'envoi de factures reconnues par l'agent mail (Olivier 06/10/2026).
insert into app_settings (key, value) values
  ('mail_factures_plateformes', '["billtobox.be","pennylane.com","clearfacts.be","storecove.com","codabox.com","einvoicing","clouddematinvoicing","falco-app.be"]')
on conflict (key) do nothing;
notify pgrst, 'reload schema';
