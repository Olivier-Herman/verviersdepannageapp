-- Contrôle du parc (Olivier 21/10/2026) — remplace l'ancien inventaire.
-- Un contrôle fige la liste des voitures attendues au parc (zone par zone),
-- plusieurs téléphones scannent en même temps, l'écran de contrôle suit en direct,
-- puis l'analyse de fin propose une décision pour chaque voiture non retrouvée.

-- Zone Domaine : les véhicules remis au Domaine y sont rangés après le contrôle.
insert into public.parc_zones (key, label, sort_order, depot_id, active)
select 'Domaine', 'Domaine', 160, z.depot_id, true
from public.parc_zones z
where z.key = 'A' and not exists (select 1 from public.parc_zones d where d.key = 'Domaine');

create table if not exists public.parc_controles (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'en_cours',   -- en_cours | cloture | applique
  started_at   timestamptz not null default now(),
  started_by   uuid,
  closed_at    timestamptz,
  closed_by    uuid,
  applied_at   timestamptz,
  applied_by   uuid,
  zones_done   jsonb not null default '{}'::jsonb, -- { "A": { "at": "...", "by": "Jona" } }
  scanners     jsonb not null default '{}'::jsonb, -- { "<user_id>": { "name": "Jona", "zone": "A", "at": "..." } }
  note         text
);

create table if not exists public.parc_controle_items (
  id             uuid primary key default gen_random_uuid(),
  controle_id    uuid not null references public.parc_controles(id) on delete cascade,
  mission_id     uuid,
  expected       boolean not null default true,  -- false = trouvée au parc sans y être attendue
  expected_zone  text,
  plate          text,
  vehicle        text,
  mission_number bigint,
  source         text,
  status_at_start text,
  is_domaine     boolean not null default false,
  scanned_at     timestamptz,
  scanned_by     uuid,
  scanned_by_name text,
  scanned_zone   text,                            -- zone choisie sur le téléphone
  result         text,                            -- ok | transfere | domaine | en_trop
  moved_from     text,
  moved_to       text,
  via            text,                            -- etiquette | photo | plaque
  photo_path     text,
  analysis       jsonb,                           -- { category, label, facts[], proposal }
  decision       text,                            -- sortir | rechercher | laisser | remettre | enquete | domaine
  decision_at    timestamptz,
  decision_by    uuid,
  applied_at     timestamptz,
  applied_result text,
  created_at     timestamptz not null default now()
);
create index if not exists parc_controle_items_ctrl on public.parc_controle_items (controle_id);
create unique index if not exists parc_controle_items_ctrl_mission on public.parc_controle_items (controle_id, mission_id) where mission_id is not null;

alter table public.parc_controles disable row level security;
alter table public.parc_controle_items disable row level security;
grant all on public.parc_controles to service_role;
grant all on public.parc_controle_items to service_role;

notify pgrst, 'reload schema';
