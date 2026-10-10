-- Espace client (Olivier 10/10/2026) : EBAC et Centracar suivent leurs missions, téléchargent le rapport
-- d'intervention et la facture, et commandent une intervention qui arrive dans les commandes du dispatch.
-- Ce qui s'affiche dépend du CLIENT FACTURÉ (billed_to_id), jamais de la source.
--
-- Comptes :
--   societe       → l'adresse générale d'une société (info@…) : toutes les missions de sa société ;
--   gestionnaire  → plusieurs sociétés (Justin) : toutes leurs missions, crée des collaborateurs ;
--   collaborateur → une seule société, ne voit QUE les missions qu'il a commandées depuis l'espace ;
--                   peut ajouter d'autres collaborateurs de sa société si on le lui a permis.
-- Un compte peut avoir plusieurs adresses de connexion (Justin : centracar.be et ebac-auto.be).

create table if not exists espace_societes (
  id              uuid primary key default gen_random_uuid(),
  nom             text not null,
  odoo_partner_id int  not null unique,          -- client facturé
  source_key      text not null,                 -- source des missions commandées (mission_source_catalog.key)
  appel_audio     text,                          -- message vocal joué au dépannage (fichier dans /public/sounds)
  couleur         text,                          -- teinte de la société dans l'espace (#rrggbb)
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists espace_comptes (
  id                uuid primary key default gen_random_uuid(),
  nom               text not null,
  emails            text[] not null,             -- adresses de connexion, en minuscules
  password_hash     text,
  role              text not null check (role in ('societe', 'gestionnaire', 'collaborateur')),
  societe_ids       uuid[] not null default '{}',
  peut_inviter      boolean not null default false,
  invite_par        uuid references espace_comptes(id),
  session_version   int not null default 1,      -- +1 = toutes les sessions du compte sont coupées
  active            boolean not null default true,
  derniere_connexion timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists espace_comptes_emails on espace_comptes using gin (emails);

create table if not exists espace_codes (
  id          uuid primary key default gen_random_uuid(),
  compte_id   uuid not null references espace_comptes(id) on delete cascade,
  code_hash   text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  tentatives  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists espace_codes_compte on espace_codes (compte_id, created_at desc);

-- Appel au dépannage à l'arrivée d'une demande : décroché → message vocal ; message fini → raccroché.
create table if not exists espace_appels (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid not null,
  call_id     text,
  audio       text,
  status      text not null default 'lance',
  detail      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists espace_appels_call on espace_appels (call_id);

alter table incoming_missions add column if not exists espace_compte_id uuid;
create index if not exists incoming_missions_espace_compte on incoming_missions (espace_compte_id) where espace_compte_id is not null;

alter table espace_societes disable row level security;
alter table espace_comptes  disable row level security;
alter table espace_codes    disable row level security;
alter table espace_appels   disable row level security;
grant all on espace_societes, espace_comptes, espace_codes, espace_appels to service_role;

notify pgrst, 'reload schema';
