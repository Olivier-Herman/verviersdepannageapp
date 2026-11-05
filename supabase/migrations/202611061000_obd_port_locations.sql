-- Emplacement de la prise OBD par modèle (Olivier 06/11/2026, maquette https://claude.ai/artifact/8U668FhJzuhYdyDeY6BSkg validée).
-- a_confirmer : indication de Sam, avec sa source. verifie : confirmé par au moins un chauffeur.
create table if not exists public.obd_port_locations (
  id            uuid primary key default gen_random_uuid(),
  model_key     text not null unique,
  aliases       text[] not null default '{}',
  label         text not null,
  fr            text not null,
  sq            text not null,
  status        text not null default 'a_confirmer' check (status in ('a_confirmer','verifie')),
  source_url    text,
  confirmed_by  uuid[] not null default '{}',
  photo_path    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists obd_port_locations_aliases_idx on public.obd_port_locations using gin (aliases);
alter table public.obd_port_locations disable row level security;
grant all on public.obd_port_locations to service_role;
notify pgrst, 'reload schema';
