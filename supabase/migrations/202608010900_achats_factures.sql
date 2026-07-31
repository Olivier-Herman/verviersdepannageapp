-- Module Gestion Achat : cache d'analyse des factures fournisseurs.
-- Une ligne par facture Odoo (account.move in_invoice) + la CATÉGORISATION IA
-- (parsing du document par Claude). Sert le dashboard « dépense par catégorie ».
-- Table serveur-only (accès service_role) → RLS ENABLE, service_role contourne.

create table if not exists public.achats_factures (
  odoo_move_id   bigint primary key,          -- account.move.id
  partner_id     bigint,
  supplier_name  text,
  invoice_date   date,
  amount_htva    numeric,
  amount_total   numeric,
  ref            text,                          -- n° facture fournisseur
  attachment_id  bigint,                        -- ir.attachment principal
  doc_mimetype   text,                          -- application/pdf, application/xml…
  -- Catégorisation IA
  categorie      text,
  sous_categorie text,
  resume         text,
  items          jsonb,                         -- [{description, montant}]
  confidence     numeric,
  model          text,
  parsed_at      timestamptz,
  parse_error    text,
  synced_at      timestamptz not null default now()
);

create index if not exists idx_achats_fact_cat    on public.achats_factures (categorie);
create index if not exists idx_achats_fact_parsed on public.achats_factures (parsed_at);
create index if not exists idx_achats_fact_date    on public.achats_factures (invoice_date);
create index if not exists idx_achats_fact_partner on public.achats_factures (partner_id);

alter table public.achats_factures enable row level security;
grant all on public.achats_factures to service_role;

notify pgrst, 'reload schema';
