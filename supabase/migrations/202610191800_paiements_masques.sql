-- Paiements fournisseurs (Olivier 19/10/2026) : factures précises masquées du tri (absentes des postes ouverts de la
-- comptable) : Bouny BILL/2026/04/0045, Marquardt BILL/2026/04/0097, HP Assistance BILL/2026/04/0098,
-- Van Dongen BILL/2026/05/0035. Le fournisseur reste affiché pour ses autres factures.
insert into public.app_settings (key, value) values
  ('paiements_masques_move_ids', '["16192","18885","18895","17424"]')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
