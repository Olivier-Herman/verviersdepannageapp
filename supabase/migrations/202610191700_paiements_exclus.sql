-- Paiements fournisseurs (Olivier 19/10/2026) : fournisseurs payés automatiquement, jamais affichés au tri.
-- Police Fédérale (79 : la facture arrive après paiement), ING (865), BNP Paribas Fortis (910), Belfius (901) : prélevés d'office.
insert into public.app_settings (key, value) values
  ('paiements_exclus_partner_ids', '["79","865","910","901"]')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
