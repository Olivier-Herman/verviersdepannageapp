-- Sam, l'aide des chauffeurs (Olivier 03/10/2026) : bouton « Aide » dans
-- l'app et bot Telegram @VerviersDepannageBot. Telegram ne sert QU'À l'aide :
-- aucune notification de mission n'y passe.

-- Liaison d'un compte VD Soft à un chat Telegram (une liaison = un compte).
create table if not exists public.telegram_links (
  user_id     uuid primary key references public.users(id) on delete cascade,
  chat_id     bigint not null unique,
  tg_username text,
  linked_at   timestamptz not null default now()
);

-- Codes de liaison à usage unique (15 minutes), créés depuis le profil.
create table if not exists public.telegram_link_codes (
  code        text primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

-- État de la conversation côté VD Soft (l'historique est gardé par le bureau) :
-- mission en cours de discussion, boutons proposés, action en attente du
-- « Oui, fais-le » du chauffeur. Jamais exécutée sans ce oui.
create table if not exists public.sam_state (
  user_id         uuid primary key references public.users(id) on delete cascade,
  mission_id      uuid,
  buttons         jsonb not null default '[]'::jsonb,
  pending_action  jsonb,
  updated_at      timestamptz not null default now()
);

alter table public.telegram_links      enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.sam_state           enable row level security;
grant all on public.telegram_links, public.telegram_link_codes, public.sam_state to service_role;

notify pgrst, 'reload schema';
