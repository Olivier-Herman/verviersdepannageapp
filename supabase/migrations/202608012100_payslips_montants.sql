-- Paie : montants lus sur la fiche (€), socle pour le rapprochement Odoo
-- (net à payer) et la rentabilité par chauffeur (coût employeur).

alter table public.payslips add column if not exists montant_net    numeric;   -- net à payer
alter table public.payslips add column if not exists montant_brut   numeric;   -- brut imposable
alter table public.payslips add column if not exists cout_employeur numeric;   -- coût total employeur (si présent sur la fiche)
alter table public.payslips add column if not exists odoo_move_id   bigint;    -- facture fournisseur Odoo liée (push)

notify pgrst, 'reload schema';
