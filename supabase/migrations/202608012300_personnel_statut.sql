-- Statut du travailleur → détermine le compte de charge Odoo au push des fiches.
-- ouvrier → 620300 · employe → 620200 · gerant → 620000. Défaut applicatif = ouvrier.
alter table public.personnel add column if not exists statut text;

notify pgrst, 'reload schema';
