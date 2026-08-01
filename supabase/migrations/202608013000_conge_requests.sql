-- Module Congés : demandes des travailleurs → validation RH/superadmin (PIN) →
-- écriture auto du code sur la feuille de présence + notification.
create table if not exists public.conge_requests (
  id             uuid primary key default gen_random_uuid(),
  personnel_id   uuid,
  user_id        uuid,
  type           text,                    -- conge | recup | sans_solde
  start_date     date,
  end_date       date,
  days           int,                     -- nb de jours ouvrables demandés
  reason         text,
  status         text default 'pending',  -- pending | approved | refused
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text,
  applied        boolean default false,   -- écrit sur la/les feuille(s) de présence
  created_at     timestamptz default now()
);
alter table public.conge_requests enable row level security;
grant all on public.conge_requests to service_role;

notify pgrst, 'reload schema';
