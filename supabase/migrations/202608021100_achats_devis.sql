-- Comparateur de devis (brique 3 Achat IA) : un « besoin » (quote_request)
-- regroupe plusieurs devis fournisseurs (quotes) extraits par Claude, comparés
-- et départagés par l'IA. Live le 2026-08-02.

create table if not exists achats_quote_requests (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,          -- le besoin, ex. "4 pneus 225/65R16 camion X"
  notes      text,
  reco       text,                   -- recommandation IA (dernier comparatif)
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists achats_quotes (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid not null references achats_quote_requests(id) on delete cascade,
  supplier_name       text,
  supplier_partner_id bigint,         -- rattachement au répertoire fournisseurs (optionnel)
  total_htva          numeric,
  currency            text default 'EUR',
  delivery_days       int,
  payment_terms       text,
  validity            text,
  items               jsonb not null default '[]',   -- [{description, qty, unit_price, total}]
  summary             text,
  file_name           text,
  created_at          timestamptz not null default now()
);

alter table achats_quote_requests enable row level security;
alter table achats_quotes enable row level security;
grant all on table achats_quote_requests to service_role, postgres;
grant all on table achats_quotes to service_role, postgres;
notify pgrst, 'reload schema';
