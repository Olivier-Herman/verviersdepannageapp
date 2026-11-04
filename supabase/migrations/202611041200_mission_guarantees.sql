-- Garanties de paiement des assistances (GOP Allianz…) : lues automatiquement dans les mails
-- et placées sur la fiche qu'elles couvrent (Olivier 04/11/2026, dossier 1ABV287).
create table if not exists public.mission_guarantees (
  id                 uuid primary key default gen_random_uuid(),
  mission_id         uuid references public.incoming_missions(id) on delete set null,
  assistance         text not null,
  dossier_ref        text,
  assistance_mission text,
  plate              text,
  vin                text,
  amount_ttc         numeric(10,2),
  client_name        text,
  client_address     text,
  client_phone       text,
  incident_at        text,
  doc_path           text,
  source_email_id    text unique,
  status             text not null default 'placed' check (status in ('placed','to_verify')),
  placed_how         text,
  created_at         timestamptz not null default now()
);
create index if not exists mission_guarantees_mission_idx on public.mission_guarantees(mission_id);
alter table public.mission_guarantees disable row level security;
grant all on public.mission_guarantees to service_role;
notify pgrst, 'reload schema';
