-- Module « Visiteur au comptoir » — registre de visite d'un véhicule EN PARC.
--
-- Une personne vient récupérer des affaires / faire expertiser un véhicule au
-- parc, SANS passer par le QR. L'opérateur clique « Visiteur » sur la fiche
-- (véhicule en parc) → l'écran comptoir lit la carte d'identité + fait choisir
-- le(s) motif(s). Retour → une ligne dans mission_visitors. Ajout manuel
-- possible (refus de lecture eID).
--
-- Motifs ET bureaux d'expertise 100 % paramétrables par le superadmin
-- (zéro hardcode). Olivier 2026-08-08.

-- ── Catalogue des motifs de visite (paramétrable /admin) ────────────────────
create table if not exists public.visitor_motifs (
  id         uuid primary key default gen_random_uuid(),
  label      text    not null,
  is_expert  boolean not null default false,  -- ce motif déclenche le choix d'un bureau d'expertise
  sort_order int     not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── Catalogue des bureaux d'expertise (paramétrable /admin) ─────────────────
create table if not exists public.expertise_bureaus (
  id         uuid primary key default gen_random_uuid(),
  name       text    not null,
  sort_order int     not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── Registre des visites (rattaché à la fiche mission / véhicule en parc) ────
create table if not exists public.mission_visitors (
  id            uuid primary key default gen_random_uuid(),
  mission_id    uuid not null references public.incoming_missions(id) on delete cascade,
  visited_at    timestamptz not null default now(),
  last_name     text,
  first_name    text,
  birth_date    text,               -- tel que lu sur la carte (JJ/MM/AAAA) ou saisi
  motifs        text[] not null default '{}',   -- libellés (durables même si le catalogue change)
  expert_bureau text,               -- si un motif « expert » est choisi
  note          text,               -- « Autre » (motif ou bureau libre) / remarque
  source        text not null default 'manual', -- 'eid' | 'manual'
  national_number text,             -- optionnel (lecture eID)
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_mission_visitors_mission on public.mission_visitors (mission_id);

-- Tables serveur-only : lues/écrites via les routes API en service_role
-- (service_role contourne la RLS). On ENABLE sans policy.
alter table public.visitor_motifs    enable row level security;
alter table public.expertise_bureaus enable row level security;
alter table public.mission_visitors  enable row level security;

-- ── Seeds (points de départ — Olivier ajuste ensuite depuis /admin/visites) ──
insert into public.visitor_motifs (label, is_expert, sort_order)
select label, is_expert, so from (values
  ('Récupérer des affaires', false, 10),
  ('Expertise',              true,  20),
  ('Constat',                false, 30),
  ('Récupérer le véhicule',  false, 40),
  ('Prise de photos',        false, 50)
) as v(label, is_expert, so)
where not exists (select 1 from public.visitor_motifs);

-- Bureaux d'expertise : exemples à compléter/remplacer par Olivier.
insert into public.expertise_bureaus (name, sort_order)
select name, so from (values
  ('Dekra',        10),
  ('Autosécurité', 20),
  ('SGS',          30)
) as v(name, so)
where not exists (select 1 from public.expertise_bureaus);

-- Recharge le cache de schéma PostgREST (sinon INSERT/SELECT = KO silencieux).
notify pgrst, 'reload schema';
