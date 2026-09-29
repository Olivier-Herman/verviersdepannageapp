-- Restitution : « paiement différé » retenu par client (Olivier 29/09/2026 :
-- « on retient le client et la coche de paiement différé pour l'avoir par défaut
-- la fois suivante »). Clé = fiche client Odoo.
create table if not exists public.client_payment_prefs (
  odoo_partner_id integer primary key,
  deferred        boolean not null default false,
  updated_by      uuid,
  updated_at      timestamptz not null default now()
);
alter table public.client_payment_prefs disable row level security;
grant all on public.client_payment_prefs to service_role;

notify pgrst, 'reload schema';
