-- Veille de Max (Olivier 15/10/2026) : les questions de dispatch sans propriétaire (missions sans chauffeur,
-- commandes Car Parts à trier) vont au dispatch titulaire, pas à Jona (facturation + fourrière ; dispatch
-- seulement en remplacement exceptionnel). Une mission que Jona a lui-même attribuée lui reste posée.
insert into public.app_settings (key, value)
values ('max_veille_dispatch_users', '["bureaumomo@verviersdepannage.be","axel@verviersdepannage.be","matthieu@verviersdepannage.be"]')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
