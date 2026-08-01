-- Paie : un travailleur peut avoir PLUSIEURS fiches le même mois (Salaire,
-- Prime, Pécule de vacances, Congé…). On retire la contrainte d'unicité
-- (personnel_id, period, company_code) et on ajoute le type de fiche.

alter table public.payslips drop constraint if exists payslips_personnel_id_period_company_code_key;
alter table public.payslips add column if not exists type  text;   -- salaire | prime | vacances | conge | autre
alter table public.payslips add column if not exists label text;   -- libellé lu sur la fiche

notify pgrst, 'reload schema';
