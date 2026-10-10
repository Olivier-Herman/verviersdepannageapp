-- Espace client v2 (Olivier 10/10/2026) : un seul portail pour tous les clients (EBAC, Centracar, Car Parts,
-- Car Avenue), garages de livraison par société, message du client pour le chauffeur à confirmer.

-- Garages de la société, proposés en boutons comme lieu de livraison d'un remorquage (« ça personnalise »).
create table if not exists espace_garages (
  id          uuid primary key default gen_random_uuid(),
  societe_id  uuid not null references espace_societes(id) on delete cascade,
  nom         text not null,
  adresse     text not null,
  lat         double precision,
  lng         double precision,
  ordre       int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists espace_garages_societe on espace_garages (societe_id, ordre);
alter table espace_garages disable row level security;
grant all on espace_garages to service_role;

-- Message du client pour le chauffeur : affiché à l'acceptation, le chauffeur confirme l'avoir lu.
alter table incoming_missions add column if not exists driver_message text;
alter table incoming_missions add column if not exists driver_message_ack_at timestamptz;
alter table incoming_missions add column if not exists driver_message_ack_by uuid;

notify pgrst, 'reload schema';
