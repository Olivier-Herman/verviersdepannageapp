-- Lot 2 de Florent (Olivier 05/10/2026) : rapprochements et import Scrada.
--   rapprochement_bouton : fait seul (bouton « Rapprocher ») ;
--   rapprochement_banque : proposé, Olivier valide au début (il l'activera ensuite).
update agent_accounts set kinds = array(select distinct unnest(kinds || array['rapprochement_bouton', 'rapprochement_banque']))
  where name = 'Florent';
update agent_accounts set direct_kinds = array(select distinct unnest(direct_kinds || array['rapprochement_bouton']))
  where name = 'Florent';
insert into app_settings (key, value) values
  ('mail_scrada_coda',   '"info@scrada.be"'),
  ('mail_scrada_boite',  '"info@verviersdepannage.com"'),
  ('odoo_journal_scrada', '40'),
  ('odoo_taxe_achat_21',  '23')
on conflict (key) do nothing;
notify pgrst, 'reload schema';
