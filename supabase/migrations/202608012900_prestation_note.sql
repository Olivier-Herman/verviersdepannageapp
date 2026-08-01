-- Prestations : note/remarque par travailleur (la note générale du mois est
-- stockée dans app_settings, clé 'prestation_notes').
alter table public.prestation_sheets add column if not exists note text;

notify pgrst, 'reload schema';
