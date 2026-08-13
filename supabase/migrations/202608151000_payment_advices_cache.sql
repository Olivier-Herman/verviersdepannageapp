-- ============================================================
-- Finance › Réconciliation — cache des avis de paiement assureurs
-- ============================================================
--
-- Lire la boîte mail à chaque affichage coûtait 30 à 90 secondes : Graph pour
-- lister, Graph pour chaque pièce jointe, et Claude pour chaque PDF AWP. Or un
-- avis ne change jamais une fois reçu. On le lit donc UNE fois — par un cron à
-- 5 h et à midi — et l'écran ne lit plus que cette table.
--
-- La pièce jointe suit le même cycle que le reste du module : on la garde le
-- temps du rapprochement, on la joint au virement dans Odoo au moment du
-- lettrage (c'est là qu'elle sert, et Odoo est l'archive comptable), puis on
-- libère la place chez nous. `doc_b64` est donc volontairement éphémère —
-- `attached_move_id` garde la trace de l'endroit où le document est parti.

create table if not exists payment_advices (
  id            bigserial primary key,

  provider      text        not null check (provider in ('ima', 'awp')),
  mail_id       text        not null unique,          -- identité Graph = clé d'idempotence
  subject       text,
  received_at   timestamptz not null,

  advice_date   date,
  reference     text,
  total         numeric(12,2) not null default 0,
  lines         jsonb       not null default '[]'::jsonb,
  checksum      jsonb       not null default '{}'::jsonb,
  warnings      jsonb       not null default '[]'::jsonb,

  -- La pièce jointe d'origine, gardée jusqu'au rapprochement.
  doc_name      text,
  doc_mime      text,
  doc_bytes     integer,
  doc_b64       text,

  -- Où elle est partie dans Odoo, et quand on a libéré la place ici.
  attached_move_id integer,
  attached_at   timestamptz,
  purged_at     timestamptz,

  parse_error   text,                                  -- lecture KO : on retentera
  fetched_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists payment_advices_recent_idx
  on payment_advices (received_at desc, id desc);
create index if not exists payment_advices_provider_idx
  on payment_advices (provider, received_at desc);

-- Même règle que le reste du module : accès par la service_role uniquement,
-- via les routes API qui portent le contrôle superadmin.
alter table payment_advices disable row level security;
grant all on payment_advices to anon, authenticated, service_role;
grant usage, select on sequence payment_advices_id_seq to anon, authenticated, service_role;

notify pgrst, 'reload schema';
