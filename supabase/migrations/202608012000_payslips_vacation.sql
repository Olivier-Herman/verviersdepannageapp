-- Paie : compteurs de congés/vacances lus sur la fiche (en HEURES).
-- total = droit annuel, used = prises, available = solde restant à la date de la fiche.

alter table public.payslips add column if not exists vac_total     numeric;
alter table public.payslips add column if not exists vac_used      numeric;
alter table public.payslips add column if not exists vac_available numeric;

notify pgrst, 'reload schema';
