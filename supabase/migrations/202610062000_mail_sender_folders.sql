-- Classement appris de l'agent mail (Olivier 06/10/2026) : un mail se classe dans le dossier
-- où l'on range d'habitude ce même expéditeur. L'habitude est relevée chaque nuit dans
-- l'historique Outlook ; le choix d'Olivier sur une carte « Où classer ? » est retenu et
-- n'est jamais écrasé par le relevé (source = 'choix'). Table réglable à la main.

create table if not exists mail_sender_folders (
  mailbox     text not null,
  sender      text not null,          -- adresse de l'expéditeur, en minuscules
  folder      text not null,          -- chemin du dossier (« Boîte de réception/rgf »)
  mails       integer not null default 0,
  share       numeric not null default 0,   -- part des mails de cet expéditeur rangés là (0..1)
  source      text not null default 'historique' check (source in ('historique', 'choix')),
  updated_at  timestamptz not null default now(),
  primary key (mailbox, sender)
);

alter table mail_sender_folders disable row level security;
grant all on mail_sender_folders to service_role;

notify pgrst, 'reload schema';
