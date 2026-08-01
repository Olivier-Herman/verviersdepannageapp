-- Dossier RH complet sur la fiche employé (données perso EasyPay / secrétariat social).
alter table public.personnel add column if not exists birth_date          date;
alter table public.personnel add column if not exists birth_place         text;
alter table public.personnel add column if not exists nationalite         text;
alter table public.personnel add column if not exists national_number     text;   -- NISS / n° registre national
alter table public.personnel add column if not exists etat_civil          text;   -- célibataire, marié, cohabitant légal, divorcé, veuf, séparé
alter table public.personnel add column if not exists personnes_charge     int;    -- enfants / personnes à charge
alter table public.personnel add column if not exists adresse             text;   -- rue + n°
alter table public.personnel add column if not exists code_postal         text;
alter table public.personnel add column if not exists ville               text;
alter table public.personnel add column if not exists pays                text;
alter table public.personnel add column if not exists iban                text;
alter table public.personnel add column if not exists contact_urgence_nom text;
alter table public.personnel add column if not exists contact_urgence_tel text;

notify pgrst, 'reload schema';
