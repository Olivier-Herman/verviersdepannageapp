-- Conversations chauffeur ↔ Sam / Sonic gardées dans VD Soft (Olivier 03/10/2026).
-- Une conversation = un agent, une mission (ou aucune), terminée après 30 min
-- sans message, après une action réussie ou à la relève. Résumé de 2-3 lignes
-- à la fin. Messages supprimés après 12 mois ; le résumé reste.

create table if not exists public.sam_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  mission_id  uuid,
  agent       text not null,                 -- Sam | Sonic
  canal       text,                          -- app | telegram (dernier utilisé)
  started_at  timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  ended_at    timestamptz,
  end_reason  text check (end_reason in ('inactivite', 'action', 'releve')),
  summary     text,
  purged_at   timestamptz
);
create index if not exists sam_conversations_user_idx on public.sam_conversations (user_id, last_at desc);
create index if not exists sam_conversations_mission_idx on public.sam_conversations (mission_id) where mission_id is not null;
create index if not exists sam_conversations_open_idx on public.sam_conversations (last_at) where ended_at is null;

create table if not exists public.sam_messages (
  id               bigserial primary key,
  conversation_id  uuid not null references public.sam_conversations(id) on delete cascade,
  at               timestamptz not null default now(),
  role             text not null check (role in ('chauffeur', 'agent')),
  agent            text,                     -- prénom de l'agent pour role = agent
  canal            text,
  texte            text not null,
  texte_fr         text,                     -- traduction française (chauffeur albanophone)
  photo            boolean not null default false
);
create index if not exists sam_messages_conv_idx on public.sam_messages (conversation_id, id);

-- Journal des lectures (qui a lu quelle conversation, quand).
create table if not exists public.sam_conversation_reads (
  id               bigserial primary key,
  conversation_id  uuid not null references public.sam_conversations(id) on delete cascade,
  user_id          uuid,
  at               timestamptz not null default now()
);

alter table public.sam_conversations      enable row level security;
alter table public.sam_messages           enable row level security;
alter table public.sam_conversation_reads enable row level security;
grant all on public.sam_conversations, public.sam_messages, public.sam_conversation_reads to service_role;
grant usage, select on sequence public.sam_messages_id_seq, public.sam_conversation_reads_id_seq to service_role;

notify pgrst, 'reload schema';
