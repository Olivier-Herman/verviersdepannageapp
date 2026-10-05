-- Avis de paiement Allianz envoyés au nom d'AP Solutions (Olivier 05/10/2026) :
-- seconde adresse d'expéditeur lue par la réconciliation des assureurs.
insert into app_settings (key, value) values
  ('mail_aps_avis_paiement', '"accountancy@allianz-global-assistance.be"')
on conflict (key) do nothing;
notify pgrst, 'reload schema';
