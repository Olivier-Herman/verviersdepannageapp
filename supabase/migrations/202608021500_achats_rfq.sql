-- Appel d'offre (brique 4b Achat IA) : destinataires d'un besoin, chacun avec un
-- token unique (lien de dépôt + tracking). Live le 2026-08-02.

alter table achats_quote_requests add column if not exists spec text;

create table if not exists achats_rfq_recipients (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references achats_quote_requests(id) on delete cascade,
  name         text,
  email        text not null,
  market_id    uuid,
  partner_id   bigint,
  token        text not null unique default replace(gen_random_uuid()::text, '-', ''),
  status       text not null default 'sent',   -- sent | opened | responded | failed
  quote_id     uuid,
  sent_at      timestamptz,
  opened_at    timestamptz,
  responded_at timestamptz,
  created_at   timestamptz not null default now()
);

alter table achats_rfq_recipients enable row level security;
grant all on table achats_rfq_recipients to service_role, postgres;
notify pgrst, 'reload schema';
