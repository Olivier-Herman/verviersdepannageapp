-- Assistant bureau (Olivier 14/10/2026) : l'agent de Jona comprend et corrige les dossiers
-- VD Soft. Il ne fait rien seul : il dépose une action (résumé + avant → après), Jona
-- confirme ou annule dans la conversation, VD Soft exécute avec le compte de Jona.
-- Jamais de facturation (facture, brouillon, NC, état de frais).

alter table assistant_conversations add column if not exists mode text not null default 'admin';

create table if not exists assistant_actions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  user_id         uuid not null,
  kind            text not null,
  mission_id      uuid,
  resume          text not null,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'en_attente',   -- en_attente | faite | annulee | echec
  result          jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);
create index if not exists assistant_actions_conv on assistant_actions (conversation_id, created_at);
create index if not exists assistant_actions_status on assistant_actions (status, created_at);

alter table assistant_actions disable row level security;
grant all on assistant_actions to service_role;
grant all on assistant_conversations to service_role;

notify pgrst, 'reload schema';
