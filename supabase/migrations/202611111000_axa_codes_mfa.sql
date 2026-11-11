-- Reconnexion go&assist : AXA demande un code par mail depuis le 11/11/2026. Le robot le lit
-- dans cette boîte, uniquement dans les mails de cet expéditeur (Olivier 11/11/2026).
insert into app_settings (key, value, updated_at) values ('axa_codes_boite', '"mobi@verviersdepannage.be"', now()) on conflict (key) do nothing;
insert into app_settings (key, value, updated_at) values ('axa_codes_expediteur', '"no-reply@axa-partners.com"', now()) on conflict (key) do nothing;

notify pgrst, 'reload schema';
