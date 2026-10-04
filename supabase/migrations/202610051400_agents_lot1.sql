-- Agents HOOS dédiés à VD — lot 1 (Olivier 05/10/2026, « OK lot 1 ») :
-- l'agent prépare, une personne valide, VD Soft exécute ; traces de qui a
-- préparé et qui a validé. Lecture seule avec société obligatoire.

-- Comptes des agents : sociétés autorisées, propositions permises, envois directs.
create table if not exists agent_accounts (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  role_label        text,
  companies         int[] not null default '{}',
  kinds             text[] not null default '{}',
  direct_kinds      text[] not null default '{}',
  validator_user_id uuid references users(id) on delete set null,   -- null = superadmin (Mobi)
  key_hash          text unique,
  key_prefix        text,
  key_created_at    timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- File de propositions.
create table if not exists agent_proposals (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid references agent_accounts(id) on delete set null,
  agent_name      text not null,
  company_id      int not null,
  kind            text not null,
  title           text not null,
  why             text,
  amount          numeric,
  payload         jsonb not null default '{}'::jsonb,
  certain         boolean not null default false,
  direct          boolean not null default false,
  status          text not null default 'to_validate'
                  check (status in ('to_validate','executing','executed','refused','returned','failed')),
  validator_user_id uuid references users(id) on delete set null,
  validated_by    text,
  validated_at    timestamptz,
  refused_reason  text,
  correction      text,
  result          jsonb,
  error           text,
  executed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists agent_proposals_status_idx on agent_proposals (status, created_at desc);
create index if not exists agent_proposals_agent_idx  on agent_proposals (agent_id, created_at desc);

-- Journal : lectures, propositions, validations, refus, accès refusés.
create table if not exists agent_journal (
  id          bigserial primary key,
  agent_name  text,
  company_id  int,
  action      text not null,
  detail      text,
  ok          boolean not null default true,
  proposal_id uuid,
  actor       text,
  created_at  timestamptz not null default now()
);
create index if not exists agent_journal_created_idx on agent_journal (created_at desc);

alter table agent_accounts  disable row level security;
alter table agent_proposals disable row level security;
alter table agent_journal   disable row level security;
grant all on agent_accounts, agent_proposals, agent_journal to service_role;
grant usage, select on sequence agent_journal_id_seq to service_role;

-- Agents du lot 1 (sans clé : la clé se crée dans l'écran « Agents et droits »).
insert into agent_accounts (name, role_label, companies, kinds, direct_kinds, active) values
  ('Florent', 'Achats et lots de paiement', '{1,2}', '{lot_paiement,facture_achat}', '{}', true),
  ('Élodie',  'Facturation de nuit',        '{1}',   '{note_credit}',                '{note_credit}', true),
  ('Benoît',  'Relation avec le comptable', '{1,2}', '{envoi_comptable}',            '{envoi_comptable}', true),
  ('Rémi',    'Dépannage Riga',             '{2}',   '{facture_achat}',              '{facture_achat}', true),
  ('Gaëtan',  'DGJ VHU',                    '{3}',   '{}',                           '{}', false)
on conflict (name) do nothing;

-- Réglages métier utilisés par les exécutions (aucune valeur en dur dans le code).
insert into app_settings (key, value) values
  ('odoo_journal_paiement_fournisseurs', '12'),
  ('odoo_methode_virement_sepa',         '24'),
  ('agents_seuil_riga_htva',             '1000'),
  ('agents_copie_envois',                '["mobi@verviersdepannage.be"]')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
