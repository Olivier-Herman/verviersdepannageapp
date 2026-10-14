-- Dépôt au garage en dehors de ses heures, accepté par un employé du garage (Olivier 14/10/2026, Centracar
-- 1ENM790) : nom de l'employé, heure et chauffeur, pour expliquer le dépôt si le garage le conteste.
alter table public.incoming_missions add column if not exists depot_derogation jsonb;

notify pgrst, 'reload schema';
