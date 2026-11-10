-- Frais bancaires mensuels validés seuls par les agents malgré « doublon possible » (Olivier 10/11/2026).
insert into app_settings (key, value, updated_at) values ('agents_fournisseurs_banques', '["Belfius", "ING Belgique"]', now()) on conflict (key) do nothing;

notify pgrst, 'reload schema';
