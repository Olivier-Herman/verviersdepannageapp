-- Vérification physique de véhicules au parc (Olivier 08/10/2026) : des fiches payées restent « au parc ».
-- AVP et mal garée payés sortent d'office ; pour les accidents (et tout cas douteux), la fourrière reçoit un
-- lien personnel : pour chaque véhicule, « présent » ou « plus là ». « Plus là » sort la fiche du parc.
create table if not exists parc_verifications (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  sent_to     text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create table if not exists parc_verification_items (
  id               uuid primary key default gen_random_uuid(),
  verification_id  uuid not null references parc_verifications(id) on delete cascade,
  mission_id       uuid not null,
  sort             integer not null default 0,
  snapshot         jsonb not null default '{}'::jsonb,   -- plaque, véhicule, emplacement, entrée, paiement, photos
  exit_date        timestamptz,                          -- date de sortie à appliquer si « plus là » (date du paiement)
  answer           text check (answer in ('present', 'absent')),
  answer_note      text,
  answered_at      timestamptz,
  applied_at       timestamptz,
  applied_result   text
);
create index if not exists parc_verification_items_v on parc_verification_items (verification_id, sort);
alter table parc_verifications disable row level security;
alter table parc_verification_items disable row level security;
grant all on parc_verifications to service_role;
grant all on parc_verification_items to service_role;
notify pgrst, 'reload schema';
