-- Lot 2 de Florent (Olivier 05/10/2026) : tickets de caisse (faits seuls) et
-- refacturation des avances de fonds (validées au début, automatiques ensuite).
update agent_accounts set kinds = array(select distinct unnest(kinds || array['ticket_achat', 'refacturation_avance'])),
  direct_kinds = array(select distinct unnest(direct_kinds || array['ticket_achat']))
  where name = 'Florent';
insert into app_settings (key, value) values ('odoo_action_refacturer_avance', '1227')
on conflict (key) do nothing;
notify pgrst, 'reload schema';
