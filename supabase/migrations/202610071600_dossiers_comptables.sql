-- Dossiers comptables (Olivier 07/10/2026) : un listing annoté par la comptable (THG) devient un
-- dossier, avec une fiche par annotation. La comptable consulte et répond par un lien personnel
-- (page publique /compta/<jeton>), sans compte. Les pièces sont servies par ce même lien.

create table if not exists dossiers_comptables (
  id                 uuid primary key default gen_random_uuid(),
  company_id         integer not null default 1,
  titre              text not null,                 -- « Postes fournisseurs au 30/09/2026 »
  sous_titre         text,                          -- origine du listing
  destinataire       text,                          -- « Maureen Bastin · THG »
  intro              text,                          -- mot d'accueil (paragraphes séparés par une ligne vide)
  signature          text not null default 'Mobi',
  pied               text,                          -- pied de page (adresse de la société)
  source_message_id  text,                          -- mail d'origine (Graph)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists dossier_comptable_points (
  id           uuid primary key default gen_random_uuid(),
  dossier_id   uuid not null references dossiers_comptables(id) on delete cascade,
  numero       integer not null,                    -- ordre dans son PDF
  compte       text not null,                       -- intitulé tel qu'elle l'a écrit
  ligne        text,
  annotation   text not null,                       -- mot pour mot
  couleur      text not null default 'orange' check (couleur in ('orange', 'bleu')),
  reponse      text not null default '',
  etat         text not null default 'interne' check (etat in ('regle', 'fournisseur', 'interne')),
  suivi        text,                                -- « Facture demandée le 07/10 · relance le 14/10 »
  valide_le    timestamptz,                         -- « OK, c'est réglé » de la comptable
  updated_at   timestamptz not null default now(),
  unique (dossier_id, numero)
);

create table if not exists dossier_comptable_docs (
  id            uuid primary key default gen_random_uuid(),
  point_id      uuid not null references dossier_comptable_points(id) on delete cascade,
  nom           text not null,
  storage_path  text not null,
  mime          text not null default 'application/pdf',
  created_at    timestamptz not null default now()
);

create table if not exists dossier_comptable_events (
  id          uuid primary key default gen_random_uuid(),
  point_id    uuid not null references dossier_comptable_points(id) on delete cascade,
  auteur      text not null check (auteur in ('comptable', 'vd')),
  kind        text not null check (kind in ('ok', 'reouvert', 'remarque', 'maj')),
  texte       text,
  created_at  timestamptz not null default now()
);
create index if not exists dossier_comptable_events_point on dossier_comptable_events (point_id, created_at);

alter table dossiers_comptables disable row level security;
alter table dossier_comptable_points disable row level security;
alter table dossier_comptable_docs disable row level security;
alter table dossier_comptable_events disable row level security;
grant all on dossiers_comptables, dossier_comptable_points, dossier_comptable_docs, dossier_comptable_events to service_role;

insert into storage.buckets (id, name, public) values ('dossiers-comptables', 'dossiers-comptables', false) on conflict (id) do nothing;

-- Chat Telegram privé d'Olivier (Mobi) : soucis et validations (règle du 07/10/2026).
insert into app_settings (key, value) values ('telegram_chat_mobi', '940980269') on conflict (key) do nothing;

notify pgrst, 'reload schema';
