-- Consignes entre agents (Olivier 07/10/2026) : Victor, coordinateur des trois sociétés, dépose une
-- tâche pour un autre agent (Florent, Rémi, Gaëtan, Justine…), qui la lit à sa tournée suivante et
-- répond. Aucune action dans l'ERP par ce biais : chaque agent reste dans ses propres droits.
create table if not exists agent_consignes (
  id          uuid primary key default gen_random_uuid(),
  de          text not null,
  pour        text not null,
  societe     integer,
  texte       text not null,
  lien        text,
  etat        text not null default 'ouverte' check (etat in ('ouverte', 'prise', 'faite', 'refusee')),
  reponse     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agent_consignes_pour on agent_consignes (pour, etat, created_at);
alter table agent_consignes disable row level security;
grant all on agent_consignes to service_role;
notify pgrst, 'reload schema';
