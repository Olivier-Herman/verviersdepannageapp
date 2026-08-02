-- Répertoire fournisseurs enrichi (brique 2 Achat IA) : métadonnées par
-- fournisseur (contacts, ce qu'il fournit, conditions, scoring). Clé = partner_id
-- Odoo (canonique). Les métriques (dépense, nb factures, catégorie dominante)
-- sont calculées à la volée, pas stockées. Live le 2026-08-02.

create table if not exists achats_suppliers (
  partner_id     bigint primary key,   -- id Odoo canonique (après fusions)
  contact_name   text,
  email          text,
  phone          text,
  categories     text[] not null default '{}',   -- ce que le fournisseur fournit
  payment_terms  text,                            -- ex. "30 jours fin de mois"
  lead_time_days int,                             -- délai moyen de livraison
  rating         int,                             -- note fiabilité 1..5
  notes          text,
  updated_at     timestamptz not null default now()
);

alter table achats_suppliers enable row level security;
grant all on table achats_suppliers to service_role, postgres;
notify pgrst, 'reload schema';
