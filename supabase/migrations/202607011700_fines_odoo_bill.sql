-- 202607011700_fines_odoo_bill.sql
-- Lien vers la facture fournisseur Odoo créée pour l'amende. Olivier 2026-07-01.
-- L'« Envoyer aux achats » crée directement une facture fournisseur (account.move
-- in_invoice) en brouillon ; on stocke son id + numéro + statut ici.

alter table public.fines add column if not exists odoo_move_id     integer;
alter table public.fines add column if not exists odoo_move_name   text;     -- numéro (attribué à la validation)
alter table public.fines add column if not exists odoo_move_status text;     -- draft | posted | cancel (+ payé)

notify pgrst, 'reload schema';
