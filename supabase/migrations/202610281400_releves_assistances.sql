-- Relevé des dossiers ouverts envoyé aux assistances habituelles tous les 15 jours (Olivier 28/10/2026) : un mail
-- groupé, toujours courtois, avec un lien personnel (90 jours, sans compte) vers la page /releve/<jeton> qui liste les
-- factures ouvertes de l'assistance et permet de les télécharger. Une ligne par relevé envoyé.
create table if not exists releves_assistances (
  id           uuid primary key default gen_random_uuid(),
  partner_id   integer not null,            -- partenaire commercial ERP de l'assistance
  partner_name text,
  token        text not null unique,
  email_to     text,
  invoice_ids  integer[] not null default '{}',
  nb_factures  integer not null default 0,
  total        numeric(12,2) not null default 0,
  sent_at      timestamptz,
  expires_at   timestamptz not null,
  opened_at    timestamptz,                 -- première ouverture du lien
  created_at   timestamptz not null default now()
);
create index if not exists releves_assistances_partner_idx on releves_assistances (partner_id, sent_at desc);

alter table releves_assistances disable row level security;
grant all on releves_assistances to service_role;

notify pgrst, 'reload schema';
