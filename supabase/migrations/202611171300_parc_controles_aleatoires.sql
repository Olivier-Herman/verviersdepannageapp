-- Contrôle aléatoire du parc (Olivier 17/11/2026, maquette https://claude.ai/artifact/1DStEWrJtFLfHRLRe3E2Dv validée) :
-- mardi et jeudi entre 10 h et 15 h, samedi entre 10 h et 11 h, 15 véhicules tirés au sort à scanner.
-- Cf src/lib/parc/controle-aleatoire.ts.
create table if not exists public.parc_controles_aleatoires (
  id            uuid primary key default gen_random_uuid(),
  jour          date not null unique,                    -- un contrôle par jour prévu (heure de Bruxelles)
  prevu_at      timestamptz not null,                    -- heure tirée au sort
  status        text not null default 'prevu',           -- prevu | demande | en_cours | termine
  request_group text,
  demande_at    timestamptz,
  started_at    timestamptz,
  started_by    uuid,
  started_by_name text,
  termine_at    timestamptz,
  created_at    timestamptz not null default now()
);
create table if not exists public.parc_aleatoire_items (
  id              uuid primary key default gen_random_uuid(),
  controle_id     uuid not null references public.parc_controles_aleatoires(id) on delete cascade,
  mission_id      uuid not null,
  ordre           int not null,
  raison          text,
  zone_attendue   text,
  vu_avant_at     timestamptz,                           -- dernier contrôle « présent » avant celui-ci
  resultat        text,                                  -- present | absent | autre_zone
  zone_trouvee    text,
  repondu_at      timestamptz,
  resolution      text,                                  -- retrouve | restitue | epave | domaine | recherche
  resolution_note text,
  resolu_at       timestamptz,
  resolu_by       uuid
);
create index if not exists idx_parc_aleatoire_items_controle on public.parc_aleatoire_items(controle_id, ordre);
create index if not exists idx_parc_aleatoire_items_absents on public.parc_aleatoire_items(resultat) where resultat = 'absent' and resolu_at is null;
alter table public.parc_controles_aleatoires disable row level security;
alter table public.parc_aleatoire_items disable row level security;
grant all on public.parc_controles_aleatoires to service_role;
grant all on public.parc_aleatoire_items to service_role;
notify pgrst, 'reload schema';
