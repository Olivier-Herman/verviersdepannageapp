-- Pièces réclamées en attente (Olivier 06/10/2026) : nos demandes de pièces envoyées,
-- surveillées jusqu'à la réponse ; rappel à Olivier après 7 jours.
create table if not exists mail_piece_requests (
  id            uuid primary key default gen_random_uuid(),
  message_id    text unique not null,
  mailbox       text not null,
  emails        text[] not null default '{}',
  subject       text,
  requested_at  timestamptz not null,
  status        text not null default 'open' check (status in ('open', 'received', 'closed')),
  received_at   timestamptz,
  received_via  text,
  reminded_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists mail_piece_requests_open on mail_piece_requests (status) where status = 'open';
alter table mail_piece_requests disable row level security;
grant all on mail_piece_requests to service_role;
notify pgrst, 'reload schema';
