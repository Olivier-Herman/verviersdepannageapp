-- 202609051600_expert_access
--
-- ACCÈS EXPERTS (QR A4 à l'accueil → page publique /expert). Olivier 2026-09-05.
--   expert_devices          1 ligne par téléphone d'expert (clé stockée sur le
--                           téléphone, prénom mémorisé, jamais réencodé)
--   expert_device_bureaus   les bureaux pour lesquels ce téléphone est validé
--                           (un expert peut travailler pour plusieurs bureaux) ;
--                           validation par popup bloquant au bureau fourrière
--   mission_visitors        + expert_device_id (visite « Véhicule vu » depuis
--                           le téléphone → liste « Mes véhicules »)

create table if not exists public.expert_devices (
  id           uuid primary key default gen_random_uuid(),
  device_key   text not null unique,
  first_name   text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references public.users(id)
);

create table if not exists public.expert_device_bureaus (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references public.expert_devices(id) on delete cascade,
  bureau       text not null,                       -- libellé du bureau (expertise_bureaus.name)
  status       text not null default 'pending' check (status in ('pending', 'approved', 'refused', 'revoked')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references public.users(id),
  unique (device_id, bureau)
);
create index if not exists idx_expert_device_bureaus_device on public.expert_device_bureaus (device_id);

alter table public.mission_visitors
  add column if not exists expert_device_id uuid references public.expert_devices(id) on delete set null;
create index if not exists idx_mission_visitors_device on public.mission_visitors (expert_device_id, visited_at desc);

alter table public.expert_devices        enable row level security;
alter table public.expert_device_bureaus enable row level security;

notify pgrst, 'reload schema';
