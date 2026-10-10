-- VD Assistance (Olivier 10/10/2026) : un client = une personne avec PLUSIEURS véhicules ; chaque véhicule est relié
-- à un garage partenaire (on n'envoie pas une BMW chez un garage VW) et porte sa propre prise en charge.
-- Le client ne change jamais le garage d'un véhicule : seul le dispatch peut le réaffecter.

create table if not exists espace_vehicules (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references espace_clients(id) on delete cascade,
  societe_id     uuid not null references espace_societes(id) on delete cascade,
  garage_id      uuid not null references espace_garages(id),
  plaque         text not null,
  marque         text,
  modele         text,
  assistance     boolean not null default false,
  assistance_par text,
  assistance_le  timestamptz,
  garage_change_par text,
  garage_change_le  timestamptz,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists espace_vehicules_client_plaque on espace_vehicules (client_id, plaque) where active;
create index if not exists espace_vehicules_societe on espace_vehicules (societe_id, created_at desc);
alter table espace_vehicules disable row level security;
grant all on espace_vehicules to service_role;

-- Reprise des inscriptions existantes (un véhicule par ligne client).
insert into espace_vehicules (client_id, societe_id, garage_id, plaque, marque, modele, assistance, assistance_par, assistance_le)
select c.id, c.societe_id, coalesce(c.garage_id, (select g.id from espace_garages g where g.societe_id = c.societe_id order by g.ordre limit 1)),
  c.plaque, c.marque, c.modele, c.assistance, c.assistance_par, c.assistance_le
from espace_clients c
where c.active and c.plaque <> '' and c.societe_id is not null
  and exists (select 1 from espace_garages g where g.societe_id = c.societe_id)
  and not exists (select 1 from espace_vehicules v where v.client_id = c.id);

-- Le compte client devient la personne, unique par adresse mail (plus par garage).
alter table espace_clients drop constraint if exists espace_clients_societe_id_email_key;
alter table espace_clients alter column societe_id drop not null;
alter table espace_clients alter column plaque drop not null;
create unique index if not exists espace_clients_email_actif on espace_clients (lower(email)) where active;

alter table incoming_missions add column if not exists espace_vehicule_id uuid references espace_vehicules(id) on delete set null;

notify pgrst, 'reload schema';
