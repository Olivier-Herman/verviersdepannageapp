-- Circuit de Spa (Olivier 28/10/2026)
-- 1) Agendas Outlook : info@ (chaque jour de prestation « Activité – N dépanneuse(s) ») et mobi@ (à partir de 2 dépanneuses,
--    olivier@hoos.cloud invité). Accès délégué par code d'appareil : un jeton par boîte, chiffré.
-- 2) Fiches de réservation mensuelles de Julien Beuvens : encodées automatiquement à l'arrivée.
create table if not exists public.calendar_accounts (
  mailbox        text primary key,
  refresh_token  text not null,          -- chiffré (AES-256-GCM)
  scope          text,
  connected_at   timestamptz not null default now(),
  refreshed_at   timestamptz,
  last_error     text,
  last_error_at  timestamptz
);

create table if not exists public.circuit_calendar_events (
  key          text not null,            -- p:<prestation> | w:<week-end>:<date>
  mailbox      text not null,
  event_id     text not null,
  subject      text not null,
  event_date   date not null,
  updated_at   timestamptz not null default now(),
  primary key (key, mailbox)
);

create table if not exists public.circuit_fiches (
  message_id   text primary key,         -- internetMessageId du mail de Julien
  mailbox      text not null,
  subject      text,
  received_at  timestamptz,
  mois         text,                     -- AAAA-MM
  status       text not null default 'nouvelle' check (status in ('nouvelle', 'encodee', 'partielle', 'erreur', 'ignoree')),
  lignes       jsonb,                    -- lignes lues sur la fiche
  devis        jsonb,                    -- devis créés
  a_confirmer  jsonb,                    -- lignes que le robot n'a pas su traiter
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.calendar_accounts disable row level security;
alter table public.circuit_calendar_events disable row level security;
alter table public.circuit_fiches disable row level security;
grant all on public.calendar_accounts to service_role;
grant all on public.circuit_calendar_events to service_role;
grant all on public.circuit_fiches to service_role;

notify pgrst, 'reload schema';
