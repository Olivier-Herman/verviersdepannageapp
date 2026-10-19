-- Paiements fournisseurs (Olivier 19/10/2026) : fournisseurs payés par carte de crédit, visibles au tri mais jamais
-- dans un lot de virements. Abschleppdienst Peters (295).
insert into public.app_settings (key, value) values
  ('paiements_carte_partner_ids', '["295"]')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
