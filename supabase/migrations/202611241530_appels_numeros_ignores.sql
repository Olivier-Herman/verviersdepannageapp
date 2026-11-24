-- Appels rattachés aux fiches, suite (Olivier 24/11/2026) : les numéros d'organisations (assisteurs, police, garages
-- qui appellent pour beaucoup de dossiers) inonderaient « Appels à rattacher ». Deux règles :
--   • « Ne plus proposer ce numéro » (numeros_ignores), posé depuis l'écran ;
--   • un numéro présent sur beaucoup de fiches est classé tout seul « organisation » (mode 'organisation').
create table if not exists numeros_ignores (
  numero8 text primary key,
  numero  text,
  par     uuid,
  at      timestamptz not null default now()
);
alter table numeros_ignores disable row level security;
grant all on numeros_ignores to service_role;

alter table appel_fiches drop constraint if exists appel_fiches_mode_check;
alter table appel_fiches add constraint appel_fiches_mode_check check (mode in ('auto', 'retenu', 'manuel', 'pas_lie', 'organisation'));

notify pgrst, 'reload schema';
