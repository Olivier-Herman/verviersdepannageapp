-- Agent observateur du dispatch (Olivier 18/11/2026, palier 1 de l'auto-dispatch) : à chaque attribution faite par un
-- dispatcheur, on note ce que l'agent aurait proposé (temps de route réels) et si les deux choix concordent.
-- Aucune action sur les missions : lecture et bilan hebdomadaire seulement.
create table if not exists public.dispatch_observations (
  id            uuid primary key default gen_random_uuid(),
  mission_id    uuid not null references public.incoming_missions(id) on delete cascade,
  observed_at   timestamptz not null default now(),
  attribue_a    uuid,
  attribue_par  uuid,
  periode       text,            -- jour | nuit
  mission_type  text,
  source        text,
  choisi_eta    int,             -- minutes de route (ou fin de mission + route) du chauffeur choisi
  choisi_rang   int,             -- rang du chauffeur choisi dans le classement de l'agent (1 = le même choix)
  choisi_occupe boolean,
  agent_choix   uuid,
  agent_eta     int,
  ecart_min     int,             -- choisi_eta - agent_eta
  accord        boolean,         -- null = illisible (pas d'estimation pour le chauffeur choisi)
  estimee       boolean,         -- une des deux positions est estimée (route du retour au dépôt)
  classement    jsonb,
  erreur        text
);
create index if not exists dispatch_observations_at on public.dispatch_observations (observed_at desc);
alter table public.dispatch_observations disable row level security;
grant all on public.dispatch_observations to service_role;
notify pgrst, 'reload schema';
