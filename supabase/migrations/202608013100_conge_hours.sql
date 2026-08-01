-- Congés : heures décomptées (jours ouvrables × heures/jour du travailleur).
alter table public.conge_requests add column if not exists hours numeric;

notify pgrst, 'reload schema';
