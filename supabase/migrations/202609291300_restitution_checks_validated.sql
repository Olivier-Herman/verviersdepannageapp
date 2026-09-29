-- Restitution : « Peut-il sortir ? » validé explicitement par « Suivant », même tout au vert
-- (Olivier 29/09/2026).
alter table public.restitutions add column if not exists checks_validated_at timestamptz;
alter table public.restitutions add column if not exists checks_validated_by uuid;

notify pgrst, 'reload schema';
