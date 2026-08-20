-- Module « Ventes de véhicules » — le back-office qui alimente le site public.
--
-- Deux origines de stock, une seule mécanique de vente :
--   · 'abandon' → véhicule laissé par son propriétaire (fiche mission) ;
--   · 'achat'   → véhicule racheté d'occasion pour être revendu.
-- `origin`, `mission_id`, `purchase_price`, `plate`, `vin` et `reserve_price`
-- sont INTERNES : le site n'expose jamais d'où vient le véhicule ni ce qu'il a
-- coûté (règle Olivier 2026-08-20).
--
-- Trois modes de vente par lot, parce qu'ils ne servent pas la même chose :
--   · 'fixed'   → prix affiché, premier arrivé. Pour les rachats d'occasion.
--   · 'sealed'  → enveloppe fermée : les offres ne sont pas publiées, on ouvre
--                 à la clôture et on retient la meilleure. Pour les abandons.
--   · 'auction' → enchère montante : le meilleur montant est public.
-- Le mode est une colonne, pas un choix global : on peut changer d'avis lot par
-- lot sans migration.
--
-- Un véhicule en saisie police n'entre JAMAIS ici : il part par le SPF Domaine.
-- Le garde-fou est côté API (cf /api/admin/ventes).

CREATE SEQUENCE IF NOT EXISTS vehicle_sales_ref_seq;

CREATE TABLE IF NOT EXISTS vehicle_sales (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          text UNIQUE NOT NULL
                       DEFAULT ('VD-' || to_char(now(), 'YYYY') || '-'
                                || lpad(nextval('vehicle_sales_ref_seq')::text, 3, '0')),

  -- ── origine (interne) ──
  origin             text NOT NULL DEFAULT 'achat',   -- 'abandon' | 'achat'
  mission_id         uuid,                            -- fiche d'origine si abandon
  purchase_price     numeric,                         -- ce qu'on a payé (achat)
  purchase_notes     text,

  -- ── identité du véhicule ──
  title              text NOT NULL,
  brand              text,
  model              text,
  version            text,
  first_registration date,
  mileage            integer,
  mileage_source     text,          -- 'compteur' | 'carpass' | 'inconnu'
  fuel               text,
  gearbox            text,
  power_kw           integer,
  doors              integer,
  color              text,
  plate              text,          -- interne (photos floutées côté public)
  vin                text,          -- interne

  -- ── état ──
  condition          text NOT NULL DEFAULT 'roulant',      -- 'roulant'|'non_roulant'|'pieces'
  destination        text NOT NULL DEFAULT 'circulation',  -- 'circulation'|'pieces'
  damage             text,
  ct_status          text,          -- 'ok' | 'a_refaire' | 'non_fourni'
  carpass            boolean,
  keys_count         integer,
  description        text,
  photos             jsonb NOT NULL DEFAULT '[]'::jsonb,   -- URLs publiées, dans l'ordre

  -- ── vente ──
  sale_mode          text NOT NULL DEFAULT 'sealed',       -- 'fixed'|'sealed'|'auction'
  price              numeric,       -- mode fixed : prix affiché TVAC
  reserve_price      numeric,       -- INTERNE : en dessous, on n'attribue pas
  start_price        numeric,       -- mode auction : mise à prix
  bid_step           numeric,       -- mode auction : pas minimum

  status             text NOT NULL DEFAULT 'draft',
                     -- 'draft'|'published'|'closed'|'awarded'|'sold'|'withdrawn'
  opens_at           timestamptz,
  closes_at          timestamptz,   -- null en mode fixed

  depot_id           uuid,
  visit_info         text,

  -- ── issue ──
  awarded_bid_id     uuid,
  sold_price         numeric,
  sold_at            timestamptz,
  odoo_order_id      integer,
  odoo_invoice_id    integer,

  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Une offre. `confirm_token` : l'offre ne compte qu'une fois le lien reçu par
-- e-mail cliqué — sans ça on récolte des montants fantaisistes qui ne se
-- présentent jamais.
CREATE TABLE IF NOT EXISTS vehicle_sale_bids (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id       uuid NOT NULL REFERENCES vehicle_sales(id) ON DELETE CASCADE,
  amount        numeric NOT NULL CHECK (amount > 0),
  bidder_name   text NOT NULL,
  bidder_email  text NOT NULL,
  bidder_phone  text,
  bidder_is_pro boolean NOT NULL DEFAULT false,
  bidder_vat    text,
  intent        text,          -- 'circulation' | 'pieces' | 'indecis'
  message       text,
  confirm_token text,
  confirmed_at  timestamptz,
  status        text NOT NULL DEFAULT 'pending',
                -- 'pending'|'confirmed'|'awarded'|'rejected'|'withdrawn'
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_sales_status   ON vehicle_sales (status, closes_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_sales_mission  ON vehicle_sales (mission_id);
CREATE INDEX IF NOT EXISTS idx_vsb_sale               ON vehicle_sale_bids (sale_id, amount DESC);
CREATE INDEX IF NOT EXISTS idx_vsb_token              ON vehicle_sale_bids (confirm_token);

-- Une fiche ne donne qu'un lot : un second « Mettre en vente » rouvrirait le
-- même véhicule deux fois.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_sales_mission
  ON vehicle_sales (mission_id) WHERE mission_id IS NOT NULL;

-- Convention maison : sans DISABLE RLS + GRANT, les API service-role échouent.
ALTER TABLE vehicle_sales     DISABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_sale_bids DISABLE ROW LEVEL SECURITY;
GRANT ALL ON vehicle_sales     TO service_role, anon, authenticated;
GRANT ALL ON vehicle_sale_bids TO service_role, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE vehicle_sales_ref_seq TO service_role, anon, authenticated;

NOTIFY pgrst, 'reload schema';
