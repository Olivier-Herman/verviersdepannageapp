-- Appel police lancé par le dispatch (Olivier 18/11/2026) : le dispatch donne l'adresse et le chauffeur ; le chauffeur
-- accepte, voit l'adresse, puis remplit son formulaire de création habituel (motif choisi par lui, sur place).
-- Pas de rappel ni d'appel automatique. La création par le chauffeur seul reste en place.
create table if not exists public.appels_police (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  driver_id     uuid not null,
  address       text not null,
  lat           double precision,
  lng           double precision,
  note          text,
  status        text not null default 'envoye',   -- envoye | accepte | complete | annule
  accepted_at   timestamptz,
  completed_at  timestamptz,
  cancelled_at  timestamptz,
  mission_id    uuid references public.incoming_missions(id) on delete set null
);
create index if not exists appels_police_actifs on public.appels_police (status, created_at desc);
alter table public.appels_police disable row level security;
grant all on public.appels_police to service_role;
notify pgrst, 'reload schema';
