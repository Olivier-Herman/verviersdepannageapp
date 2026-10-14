-- Veille de Max (Olivier 14/10/2026) : missions figées signalées à la personne qui les a
-- attribuées (ou au dispatch si personne). Une ligne par question posée, pour ne jamais
-- reposer la même question tant qu'elle n'est pas réglée ou remise à plus tard.
create table if not exists max_veille (
  id            uuid primary key default gen_random_uuid(),
  mission_id    uuid not null,
  kind          text not null,              -- figee_attribuee | figee_sans_chauffeur | tri_commandes
  owner_user_id uuid,                       -- personne interrogée (null = tout le bureau)
  status        text not null default 'ouverte',   -- ouverte | reglee | plus_tard
  snooze_until  timestamptz,
  answer        text,
  answered_by   uuid,
  answered_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists max_veille_mission on max_veille (mission_id, kind, created_at desc);
create index if not exists max_veille_status on max_veille (status);
alter table max_veille disable row level security;
grant all on max_veille to service_role;
notify pgrst, 'reload schema';
