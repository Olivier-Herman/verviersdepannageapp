-- Domaine — Sujet 1 « Dates IN » : trace des remises officielles au Domaine
-- (mails SPF Finances). Table serveur-only (accès via service_role). Olivier 2026-07-29.

create table if not exists public.domaine_dates_in (
  id                 uuid primary key default gen_random_uuid(),
  source_email_id    text not null,
  received_at        timestamptz,
  remise_date        date not null,
  brand              text,
  model              text,
  vin                text,
  vin_tail           text,
  pv_remise_name     text,
  matched_mission_id uuid references public.incoming_missions(id) on delete set null,
  outcome            text not null default 'no_match',   -- applied | already_set | no_match | ambiguous
  applied_date       date,
  created_at         timestamptz not null default now()
);

create unique index if not exists uq_domaine_dates_in_email_vin on public.domaine_dates_in (source_email_id, vin);
create index if not exists idx_domaine_dates_in_vintail on public.domaine_dates_in (vin_tail);
create index if not exists idx_domaine_dates_in_remise  on public.domaine_dates_in (remise_date desc);

-- Serveur-only : RLS activé, service_role (createAdminClient) le contourne.
alter table public.domaine_dates_in enable row level security;

notify pgrst, 'reload schema';
