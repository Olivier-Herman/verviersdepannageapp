-- Doubles paiements clients tranchés par Olivier dans Telegram (07/10/2026) : un message par cas
-- dans le sujet « Doubles paiements », boutons Rembourser / Garder sur le compte client / Rappel
-- dans 15 jours. Le clic vaut son accord pour ce cas seulement.
create table if not exists doubles_paiements (
  id                 serial primary key,
  statement_line_id  integer not null unique,     -- ligne de banque (ING, Belfius, Scrada) reçue en double
  amount             numeric not null,            -- montant en trop
  invoice            text not null,               -- facture déjà réglée
  client             text not null,               -- libellé lisible
  refund_partner_id  integer not null,            -- à qui on rembourse
  keep_partner_id    integer not null,            -- sur quel compte client on garde
  refund_iban        text,
  recommend          text not null check (recommend in ('rembourser', 'garder')),
  body_html          text not null,               -- texte du message Telegram
  status             text not null default 'open' check (status in ('open', 'refunded', 'kept')),
  decided_by         text,
  decided_at         timestamptz,
  decision_note      text,
  remind_at          timestamptz,
  tg_message_id      integer,
  payment_id         integer,                     -- remboursement préparé (brouillon) dans l'ERP
  created_at         timestamptz not null default now()
);
alter table doubles_paiements disable row level security;
grant all on doubles_paiements to service_role;
grant usage, select on sequence doubles_paiements_id_seq to service_role;
notify pgrst, 'reload schema';
