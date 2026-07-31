-- Module Réception / Contacts — fondations.
-- 1) Catalogue de MOTIFS (visite/appel) paramétrable en admin — zéro hardcode.
--    Chaque motif = une COMPÉTENCE activable sur le profil employé (routage).
-- 2) Compétences employé = table de liaison user × motif (matrice admin, superadmin).
-- 3) Répertoire de contacts par fiche (numéros + emails + rôles).
-- 4) Journal d'interactions (appels, visites, mails) + file d'attente réception.
-- Tables serveur-only : accès via service_role → RLS ON (service_role contourne).
-- Le navigateur ne touche jamais ces tables (polling API).

-- 1) Catalogue de motifs ------------------------------------------------------
create table if not exists reception_motifs (
  id               uuid primary key default gen_random_uuid(),
  label            text not null,
  kind             text not null default 'visit',   -- visit, call, both
  service          text,                             -- regroupement optionnel (fourriere, rent_a_car, admin, suivi_depannage)
  requires_vehicle boolean not null default false,   -- le motif exige un véhicule/fiche
  free_text        boolean not null default false,   -- affiche un champ texte libre (ex. « Autre »)
  active           boolean not null default true,
  sort_order       int not null default 100,
  created_at       timestamptz not null default now()
);

-- Jeu de départ (uniquement si le catalogue est vide — ensuite tout se gère en admin).
insert into reception_motifs (label, kind, service, requires_vehicle, free_text, sort_order)
select * from (values
  ('Récupérer des effets',   'visit', null, true,  false, 10),
  ('Voir le véhicule',       'visit', null, true,  false, 20),
  ('Paiement / restitution', 'visit', null, true,  false, 30),
  ('Rendez-vous',            'visit', null, false, false, 40),
  ('Administratif',          'visit', null, false, false, 50),
  ('Autre',                  'both',  null, false, true,  900),
  ('Nouvelle mission',       'call',  null, false, false, 10),
  ('Appel privé',            'call',  null, false, false, 20)
) as v(label, kind, service, requires_vehicle, free_text, sort_order)
where not exists (select 1 from reception_motifs);

-- 2) Compétences employé = table de liaison user × motif (matrice admin) ------
--    Réglée par le SUPERADMIN via un écran matrice (motifs × users, toggles).
create table if not exists user_competences (
  user_id    uuid not null references users(id) on delete cascade,
  motif_id   uuid not null references reception_motifs(id) on delete cascade,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, motif_id)
);
create index if not exists idx_user_competences_motif on user_competences(motif_id);
create index if not exists idx_user_competences_user  on user_competences(user_id);
alter table user_competences enable row level security;

-- 3) Répertoire de contacts ---------------------------------------------------
create table if not exists fiche_contacts (
  id            uuid primary key default gen_random_uuid(),
  mission_id    uuid references incoming_missions(id) on delete cascade,
  name          text,
  role          text not null default 'autre',   -- client, assistance, courtier, ami, visiteur, autre
  phone         text,                             -- affichage (tel que saisi/normalisé)
  phone_key     text,                             -- 9 derniers chiffres → matching robuste
  email         text,                             -- minuscule
  redirect_to   text,                             -- redirection explicite (téléphonie)
  source        text not null default 'manual',   -- auto_client, auto_assistance, linked_call, linked_visit, manual
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_fiche_contacts_mission   on fiche_contacts(mission_id);
create index if not exists idx_fiche_contacts_phone_key on fiche_contacts(phone_key);
create index if not exists idx_fiche_contacts_email     on fiche_contacts(email);

-- 4) Journal d'interactions + file d'attente réception ------------------------
create table if not exists fiche_interactions (
  id               uuid primary key default gen_random_uuid(),
  mission_id       uuid references incoming_missions(id) on delete set null,
  contact_id       uuid references fiche_contacts(id) on delete set null,
  type             text not null,                 -- visit, call_in, call_out, email, note
  motif_id         uuid references reception_motifs(id) on delete set null,
  motif_label      text,                          -- copie du libellé (historique stable)
  service          text,
  note             text,
  status           text not null default 'done',  -- waiting, in_progress, done, missed
  phone            text,
  email            text,
  visitor_name     text,
  handled_by       uuid references users(id),
  substituted_from uuid references users(id),
  waiting_since    timestamptz,
  started_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_fiche_interactions_mission on fiche_interactions(mission_id);
create index if not exists idx_fiche_interactions_open    on fiche_interactions(status) where status in ('waiting','in_progress');
create index if not exists idx_fiche_interactions_created on fiche_interactions(created_at);

alter table fiche_contacts     enable row level security;
alter table fiche_interactions enable row level security;
alter table reception_motifs   enable row level security;
alter table user_competences   enable row level security;

-- service_role bypasse la RLS mais a besoin des privilèges table (sinon 42501).
grant all on reception_motifs   to service_role;
grant all on user_competences   to service_role;
grant all on fiche_contacts     to service_role;
grant all on fiche_interactions to service_role;

notify pgrst, 'reload schema';
