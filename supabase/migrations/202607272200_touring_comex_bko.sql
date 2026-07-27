-- Table cache des dossiers Touring COMEX BKO (auto-facturation).
-- Le cron poll-comex-bko la synchronise (login → getDossList → match VD Soft) ;
-- l'onglet superadmin la lit ; l'acceptation la met à jour.
-- Serveur-only (accès via service_role uniquement) → RLS ENABLE, service_role contourne.

create table if not exists public.touring_comex_dossiers (
  id              uuid primary key default gen_random_uuid(),
  account         text not null,                 -- compte BKO source (VERVIERS / D68357)
  dossier         text not null,                 -- file ID = n° dossier (rapprochement)
  cid_seq_action  text,                          -- séquence action COMEX
  commande        text,                          -- n° commande Touring
  prestation      text,                          -- DEP / REM+...
  plaque          text,
  km              numeric,                        -- km proposés COMEX
  montant         numeric,                        -- total COMEX HTVA
  trajet          text,                           -- codTrajetComex
  brand           text,
  model           text,
  insurer         text,
  file_date       text,
  -- rapprochement VD Soft
  mission_id      uuid,
  mission_number  bigint,
  mission_status  text,
  mission_type    text,
  vd_montant      numeric,                        -- tarif attendu VD Soft (HTVA)
  verdict         text,                           -- 'ok' | 'verify' | 'no_match'
  -- suivi
  in_comex        boolean not null default true,  -- encore présent côté COMEX
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  accepted_at     timestamptz,
  accepted_by     uuid,
  unique (account, dossier, cid_seq_action)
);

create index if not exists idx_tcbko_in_comex on public.touring_comex_dossiers (in_comex);
create index if not exists idx_tcbko_mission  on public.touring_comex_dossiers (mission_id);

alter table public.touring_comex_dossiers enable row level security;
grant all on public.touring_comex_dossiers to service_role;

notify pgrst, 'reload schema';
