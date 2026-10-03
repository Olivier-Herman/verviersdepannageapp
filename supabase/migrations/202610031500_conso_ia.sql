-- Compteur unique de la consommation d'IA de VD Soft (Olivier 03/10/2026) :
-- une ligne par appel au service d'IA, écrite par src/lib/ai/usage.ts.
create table if not exists public.conso_ia (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  fonction     text not null,          -- ex. missions/parser, mail-agent/triage, ocr/vehicle-detect
  declencheur  text,                   -- ex. cron:poll-missions, cron:mail-agent (null = écran / route)
  modele       text,
  entree       integer not null default 0,
  sortie       integer not null default 0,
  cache_lu     integer not null default 0,
  cache_ecrit  integer not null default 0,
  cout_usd     numeric(10,5) not null default 0,
  ref          text,                   -- mission, mail… quand l'appelant le donne
  ok           boolean not null default true,
  erreur       text,
  duree_ms     integer
);
create index if not exists conso_ia_at_idx on public.conso_ia (at desc);
create index if not exists conso_ia_fonction_at_idx on public.conso_ia (fonction, at desc);

alter table public.conso_ia enable row level security;
grant all on public.conso_ia to service_role;
grant usage, select on sequence public.conso_ia_id_seq to service_role;

notify pgrst, 'reload schema';
