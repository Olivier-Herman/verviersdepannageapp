-- AS 24 / Viapass (Olivier 19/10/2026) : factures AS 24 validées par les agents = payées par domiciliation ING ;
-- les factures Viapass de la Société wallonne de financement passent sur AS 24 - Belgium (le 1er de la liste).
insert into public.app_settings (key, value) values
  ('odoo_partners_as24', '["2477","186"]'),
  ('odoo_methode_domiciliation', '70')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
