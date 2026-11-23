-- Contrôle aléatoire du parc : mail des « pas trouvés » à Mobi à la fin de chaque contrôle (Olivier 23/11/2026).
-- Cf src/lib/parc/controle-absents-mail.ts. absents_mail_at = un seul mail par contrôle.
alter table public.parc_controles_aleatoires add column if not exists absents_mail_at timestamptz;

insert into app_settings (key, value, updated_at) values
  ('controle_parc_absents_emails', '["mobi@verviersdepannage.be"]', now())
on conflict (key) do nothing;

notify pgrst, 'reload schema';
