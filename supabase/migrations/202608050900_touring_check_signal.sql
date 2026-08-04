-- Signal realtime pour le module Check Touring : mini-table SANS donnée sensible
-- (juste un compteur/timestamp). Exposée en realtime au navigateur → il recharge
-- via l'API service_role dès que ça bouge, sans exposer touring_check_dossiers.
create table if not exists public.touring_check_signal (
  id         smallint primary key default 1,
  bumped_at  timestamptz not null default now(),
  reason     text
);
insert into public.touring_check_signal (id) values (1) on conflict (id) do nothing;

alter table public.touring_check_signal enable row level security;
grant select on table public.touring_check_signal to anon, authenticated;
grant all on table public.touring_check_signal to service_role, postgres;
drop policy if exists tcs_read on public.touring_check_signal;
create policy tcs_read on public.touring_check_signal for select to anon, authenticated using (true);

-- Realtime : ajoute la table à la publication (ignore si déjà présente).
do $$ begin
  alter publication supabase_realtime add table public.touring_check_signal;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
