-- VD Assistance (Olivier 10/10/2026) : le client en panne est prévenu par notification (demande acceptée, chauffeur
-- en route, chauffeur arrivé). Abonnements du navigateur (web push) et de l'app iPhone (APNs).
create table if not exists espace_client_push (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references espace_clients(id) on delete cascade,
  kind         text not null check (kind in ('web', 'apns')),
  token        text not null,                -- endpoint web push, ou jeton APNs
  subscription jsonb,                        -- abonnement web push complet (clés)
  created_at   timestamptz not null default now(),
  unique (client_id, token)
);
alter table espace_client_push disable row level security;
grant all on espace_client_push to service_role;

notify pgrst, 'reload schema';
