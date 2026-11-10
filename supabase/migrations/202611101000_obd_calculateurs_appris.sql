-- Apprentissage des calculateurs (Olivier 10/11/2026 : « chaque fois qu'un chauffeur utilisera l'OBD, le système enrichit
-- ses connaissances »). Une ligne par adresse interrogée lors d'une lecture : qui a répondu, sous quel nom. Une adresse qui
-- répond sur deux voitures différentes du même groupe de marques est ensuite lue d'office pour ce groupe.
create table if not exists public.obd_calculateurs_obs (
  id             uuid primary key default gen_random_uuid(),
  diagnostic_id  uuid references public.obd_diagnostics(id) on delete cascade,
  vin            text,
  wmi            text,
  groupe         text,
  tx             text not null,
  rx             text,
  statut         text not null check (statut in ('ok','refus','absent','erreur')),
  nom            text,
  decouverte     boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists obd_calculateurs_obs_groupe on public.obd_calculateurs_obs (groupe, tx);
create index if not exists obd_calculateurs_obs_wmi on public.obd_calculateurs_obs (wmi, tx);
alter table public.obd_calculateurs_obs disable row level security;
grant all on public.obd_calculateurs_obs to service_role;
notify pgrst, 'reload schema';
