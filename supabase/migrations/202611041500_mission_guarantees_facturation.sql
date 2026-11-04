-- Garantie de paiement : facturation de la part de l'assistance (Olivier 04/11/2026, maquette validée).
-- gardiennage_inclus : la garantie couvre aussi le gardiennage (« ça dépend »), sinon il est à charge du client.
alter table public.mission_guarantees
  add column if not exists gardiennage_inclus   boolean not null default false,
  add column if not exists assistance_vat       text,
  add column if not exists assistance_partner_id integer,
  add column if not exists invoice_odoo_id      integer,
  add column if not exists invoice_number       text,
  add column if not exists billed_htva          numeric(10,2),
  add column if not exists billed_at            timestamptz;
notify pgrst, 'reload schema';
