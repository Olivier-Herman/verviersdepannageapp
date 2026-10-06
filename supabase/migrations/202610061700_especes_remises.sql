-- Remise des espèces à Momo (Olivier 06/10/2026) : un paiement en espèces non rapproché
-- de l'ERP (Dépannage caisse en entier, Encaissement Chauffeur depuis le 01/09) est suivi
-- jusqu'à sa confirmation par Momo (PIN), sa sortie de la caisse de l'app et son encodage
-- dans le livre de caisse Scrada. Un paiement confirmé n'est jamais représenté.
create table if not exists cash_handover_items (
  odoo_payment_id  integer primary key,
  journal          text not null,                 -- DEP1 / CHAU1
  payment_name     text not null,
  payment_date     date not null,
  amount           numeric(12,2) not null,
  invoice          text,
  client           text,
  holder_user_id   uuid references users(id),     -- qui a l'argent (chauffeur, encaisseur)
  holder_label     text,                          -- nom affiché, ou « à confirmer »
  vehicle          text,
  place            text,
  intervention_date date,
  place_guessed    boolean not null default false,
  status           text not null default 'pending'
                     check (status in ('pending','transferred','requested','confirmed','encoded','reconciled','flagged')),
  next_show_at     timestamptz,                   -- « Pas reçu » / « rappel 15 min »
  transferred_at   timestamptz,
  requested_at     timestamptz,
  confirmed_at     timestamptz,
  confirmed_by     uuid references users(id),     -- le compte de Momo utilisé
  cash_transfer_id uuid,
  encoded_at       timestamptz,
  scrada_line_id   text,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists cash_handover_items_status on cash_handover_items (status);
create table if not exists especes_pin_failures (
  id      bigserial primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
alter table cash_handover_items disable row level security;
alter table especes_pin_failures disable row level security;
grant all on cash_handover_items to service_role;
grant all on especes_pin_failures to service_role;
grant usage, select on sequence especes_pin_failures_id_seq to service_role;
insert into app_settings (key, value) values
  ('especes_momo_user_ids', '["1b628f46-44ef-4a89-bdd7-a648e03f2154","e7cbab7f-1d0a-4109-ab60-7b223d088b57"]'),
  ('especes_receveur_user_id', '"1b628f46-44ef-4a89-bdd7-a648e03f2154"'),
  ('scrada_type_paiement_client', '"5781be90-4778-4ae4-973c-3b4690b3776d"'),
  ('odoo_journal_caisse_depannage', '13'),
  ('odoo_journal_encaissement_chauffeur', '15'),
  ('odoo_methode_especes_depannage', '7'),
  ('odoo_methode_especes_chauffeur', '14'),
  ('especes_scrada_actif', '"non"')
on conflict (key) do nothing;
notify pgrst, 'reload schema';
