-- Écart toléré entre le montant facturé et le calcul VD Soft (Olivier 09/10/2026) : une assistance qui paie
-- quelques euros de moins ne laisse plus le groupe « à facturer » en entier (risque de double facture).
insert into app_settings (key, value) values ('facturation_tolerance_ecart', '5') on conflict (key) do nothing;

notify pgrst, 'reload schema';
