-- Mobia, assistant de Momo (Olivier 03/10/2026) : prépare un brouillon de
-- réponse pour chaque nouveau mail du dossier « Claudy » d'info@.
-- Un mail = une ligne, clé = internet_message_id (stable même si le mail est
-- déplacé). La ligne est posée AVANT le traitement (statut 'processing') : deux
-- passages du robot ne peuvent pas créer deux brouillons pour le même mail.

create table if not exists public.mobia_mails (
  key           text primary key,              -- internet_message_id (sinon id Graph)
  message_id    text,                          -- id Graph au moment du traitement
  subject       text,
  from_email    text,
  received_at   timestamptz,
  status        text not null default 'processing' check (status in ('processing', 'done', 'error', 'legacy')),
  attempts      integer not null default 0,
  draft_id      text,
  summary       text,                          -- la ligne envoyée à Momo
  error         text,
  usage         jsonb,                         -- jetons consommés
  cost_usd      numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.mobia_mails is
  'Mails du dossier Claudy (info@) traités par Mobia : un brouillon par mail, jamais deux. legacy = traité avant Mobia.';

alter table public.mobia_mails enable row level security;
grant all on public.mobia_mails to service_role;

-- Réglages (app_settings, valeur = texte JSON).
insert into public.app_settings (key, value, updated_at) values
  ('mobia_dossier',          '"Claudy"', now()),
  ('mobia_notify_user_ids',  '["e7cbab7f-1d0a-4109-ab60-7b223d088b57"]', now())
on conflict (key) do nothing;

notify pgrst, 'reload schema';
