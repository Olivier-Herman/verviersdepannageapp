-- Module « Dossier de destruction » (Olivier 10/09/2026) : un dossier photo + constat
-- par véhicule qui quitte le parc pour la casse (Car Parts & Recycling), consultable
-- le jour où quelqu'un se présente : état, VIN, coût calculé À LA DATE DE PRÉSENTATION.
-- Aucun envoi à la commune, aucune facture Odoo : un document, c'est tout.
CREATE SEQUENCE IF NOT EXISTS destruction_dossier_seq;
CREATE TABLE IF NOT EXISTS destruction_dossiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_number  text UNIQUE NOT NULL,
  mission_id      uuid REFERENCES incoming_missions(id) ON DELETE SET NULL,
  qr_scanned      boolean NOT NULL DEFAULT false,
  vin             text,
  vin_image       int,
  plate           text,
  brand           text,
  model           text,
  color           text,
  condition       jsonb,                      -- { carrosserie, vitres, roues, interieur, remarques }
  photos          text[] NOT NULL DEFAULT '{}',
  parc_zone_key   text,
  entered_at      timestamptz,                -- entrée au parc (parked_at, sinon estimée)
  exited_at       timestamptz NOT NULL DEFAULT now(),
  grid_source     text NOT NULL DEFAULT 'police_avp',   -- grille de restitution utilisée pour le calcul
  regime          text,
  cost_snapshot   jsonb,                      -- frais figés à la sortie (référence interne)
  epaviste        text,
  forced          boolean NOT NULL DEFAULT false,
  forced_reason   text,
  forced_by       uuid,
  created_by      uuid,
  created_by_name text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS destruction_dossiers_vin_idx ON destruction_dossiers (upper(vin));
CREATE INDEX IF NOT EXISTS destruction_dossiers_exited_idx ON destruction_dossiers (exited_at DESC);
CREATE TABLE IF NOT EXISTS destruction_claims (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id    uuid NOT NULL REFERENCES destruction_dossiers(id) ON DELETE CASCADE,
  presented_at  timestamptz NOT NULL DEFAULT now(),
  person        text,
  note          text,
  computed      jsonb,                        -- frais calculés à la date de présentation
  created_by    uuid,
  created_by_name text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE destruction_dossiers DISABLE ROW LEVEL SECURITY;
ALTER TABLE destruction_claims   DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE destruction_dossiers, destruction_claims TO service_role, postgres;
GRANT USAGE, SELECT ON SEQUENCE destruction_dossier_seq TO service_role, postgres;
-- Réglage métier : l'épaviste (Olivier 10/09 : « Épaviste = Car Parts Recycling »).
INSERT INTO app_settings (key, value, updated_at) VALUES ('epaviste_destruction', '"Car Parts & Recycling"', now()) ON CONFLICT (key) DO NOTHING;
NOTIFY pgrst, 'reload schema';
