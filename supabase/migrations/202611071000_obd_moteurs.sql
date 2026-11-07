-- Choix du moteur sur le diagnostic OBD (Olivier 07/11/2026, maquette https://claude.ai/artifact/PCbNo4ctzHu2L8KDcwYm87 validée).
-- Liste par marque, modèle et année : trouvée par Sam (a_confirmer), puis confirmée par les choix des chauffeurs (verifie).
create table if not exists public.obd_engine_options (
  id          uuid primary key default gen_random_uuid(),
  model_key   text not null unique,
  label       text not null,
  options     jsonb not null default '[]'::jsonb,   -- [{ id, label, carburant, votes: [user_id] }]
  status      text not null default 'a_confirmer' check (status in ('a_confirmer','verifie')),
  source_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.obd_engine_options disable row level security;
grant all on public.obd_engine_options to service_role;
alter table public.obd_diagnostics add column if not exists moteur text;
notify pgrst, 'reload schema';
