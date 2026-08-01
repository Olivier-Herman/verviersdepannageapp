-- Self-service travailleur : journal des modifications d'infos perso faites par
-- l'employé, à transmettre au secrétariat social (EasyPay) au relevé suivant.
create table if not exists public.personnel_changes (
  id             uuid primary key default gen_random_uuid(),
  personnel_id   uuid,
  user_id        uuid,
  field          text,
  label          text,
  old_value      text,
  new_value      text,
  created_at     timestamptz default now(),
  transmitted    boolean default false,
  transmitted_at timestamptz
);
alter table public.personnel_changes enable row level security;
grant all on public.personnel_changes to service_role;

notify pgrst, 'reload schema';
