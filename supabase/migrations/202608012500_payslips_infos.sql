-- Infos perso lues sur la fiche de paie (adresse, NISS, IBAN, état civil, personnes
-- à charge) → recoupées avec la fiche VD Soft pour le double contrôle.
alter table public.payslips add column if not exists slip_infos jsonb;

notify pgrst, 'reload schema';
