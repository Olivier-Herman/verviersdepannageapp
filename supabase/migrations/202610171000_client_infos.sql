-- Ce que chaque appareil transmet de lui-même à l'ouverture de l'app (Olivier 17/10/2026) :
-- savoir quelle version de l'app iPhone chacun a installée, pour proposer la mise à jour
-- seulement à ceux qui sont en retard. Une ligne par personne et par appareil.
create table if not exists client_infos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  device_key   text not null,               -- empreinte simple de l'appareil (plateforme + modèle)
  platform     text,                        -- ios | android | web
  user_agent   text,
  app_version  text,                        -- version de l'app native si connue
  app_build    text,
  plugins      text[],
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  unique (user_id, device_key)
);
alter table client_infos disable row level security;
grant all on client_infos to service_role;
notify pgrst, 'reload schema';
