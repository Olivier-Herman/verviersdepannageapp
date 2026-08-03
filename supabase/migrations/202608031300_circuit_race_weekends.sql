-- Week-ends de course (circuit) : encodage par jour → devis Odoo (brouillon).
-- days jsonb : [{date, nb, jour, nuit, supp}]. Live le 2026-08-03.

create table if not exists circuit_race_weekends (
  id                    uuid primary key default gen_random_uuid(),
  label                 text not null,
  client_name           text,
  client_odoo_id        integer,
  days                  jsonb not null default '[]',
  notes                 text,
  odoo_sale_order_id    integer,
  odoo_sale_order_name  text,
  invoiced_at           timestamptz,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table circuit_race_weekends enable row level security;
grant all on table circuit_race_weekends to service_role, postgres;
notify pgrst, 'reload schema';
