-- Domaine — Sujet 2 « Vente d'épaves ».
-- Mail de rosemarie.lehnen@minfin.fed.be (sujet « Vente d'épaves ») annonçant la
-- vente par soumission des épaves à une firme. On pose sur la fiche saisie :
--   domaine_vente_date (= date du mail), domaine_vente_firm (firme gagnante),
--   domaine_enlevement_date (= date maximale d'enlèvement du mail, = Date OUT).
-- Trace de chaque ligne vue dans domaine_ventes_epaves.

alter table incoming_missions
  add column if not exists domaine_vente_firm text;

create table if not exists domaine_ventes_epaves (
  id                  uuid primary key default gen_random_uuid(),
  source_email_id     text not null,
  received_at         timestamptz,
  firm                text,
  vente_date          date not null,
  max_enlevement_date date,
  numero              text,            -- N° véhicule tel qu'indiqué dans le mail
  brand               text,
  model               text,
  vin                 text,
  vin_tail            text,
  matched_mission_id  uuid references incoming_missions(id) on delete set null,
  outcome             text not null default 'no_match',   -- applied | already_set | no_match | ambiguous
  created_at          timestamptz default now()
);

create unique index if not exists uq_ventes_epaves_email_vin on domaine_ventes_epaves(source_email_id, vin);
create index if not exists idx_ventes_epaves_vin_tail   on domaine_ventes_epaves(vin_tail);
create index if not exists idx_ventes_epaves_vente_date on domaine_ventes_epaves(vente_date desc);

-- Table serveur-only (accès via service_role / createAdminClient) : RLS ON, le
-- service_role la contourne.
alter table domaine_ventes_epaves enable row level security;

notify pgrst, 'reload schema';
