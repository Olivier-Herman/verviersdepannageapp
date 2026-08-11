-- Activation du FLUX 2 par CHAUFFEUR × ASSISTANCE (Olivier 2026-08-11).
--
-- Remplace le gate en dur (testeurs codés + flags par assistance) par une grille
-- pilotable depuis /admin/flux2 : une case cochée = flux 2 actif pour CE couple.
-- Activer un chauffeur sur Touring n'ouvre RIEN d'autre pour lui — VAB, Kaze et
-- les autres restent fermés tant que leur case n'est pas cochée explicitement.
--
-- assistance_key = clé de mission_source_catalog (touring, vab, kaze, allianz…).

create table if not exists public.flux2_activation (
  driver_id      uuid not null references public.users(id) on delete cascade,
  assistance_key text not null,
  enabled        boolean not null default true,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  primary key (driver_id, assistance_key)
);

create index if not exists flux2_activation_driver_idx on public.flux2_activation (driver_id);

-- Table serveur-only (lue/écrite via service_role, qui contourne RLS).
alter table public.flux2_activation enable row level security;
grant all on public.flux2_activation to service_role;

-- Continuité avec le test en cours : Franck reste ouvert sur Touring (6 clôtures
-- réelles réussies le 11/08). Les autres couples restent fermés — y compris
-- Franck × VAB, qui s'ouvrira d'un clic quand tu le décideras.
insert into public.flux2_activation (driver_id, assistance_key, enabled)
values ('de9a37aa-41b5-4a56-894b-cc304f601d1a', 'touring', true)
on conflict (driver_id, assistance_key) do nothing;

notify pgrst, 'reload schema';
