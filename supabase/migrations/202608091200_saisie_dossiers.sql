-- 202608091200_saisie_dossiers
--
-- Module Facturation SAISIE — couche de suivi (machine à états) au-dessus d'une
-- mission police_saisie. 1 dossier = 1 mission saisie. Pilote le cycle
-- parquet/client/domaine : état de frais → validation → JustInvoice → facture
-- Odoo/Peppol → gardiennage récurrent → clôture (remise Domaine / restitution).
-- Olivier 2026-08-09.
--
-- Table SERVEUR-ONLY (données facturation/légales) : accès uniquement via API
-- service_role (createAdminClient) → RLS ENABLE sans policy (service_role
-- contourne). Pas de GRANT anon.

-- ── Compteur de numéros d'état de frais (EF-AAAA-NNNN, séquentiel par année) ──
CREATE TABLE IF NOT EXISTS saisie_ef_counter (
  year      int PRIMARY KEY,
  last_seq  int NOT NULL DEFAULT 0
);
ALTER TABLE saisie_ef_counter ENABLE ROW LEVEL SECURITY;
GRANT ALL ON saisie_ef_counter TO service_role;

-- Attribue atomiquement le prochain numéro EF de l'année et le renvoie formaté.
CREATE OR REPLACE FUNCTION next_saisie_ef_number(p_year int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE seq int;
BEGIN
  INSERT INTO saisie_ef_counter(year, last_seq) VALUES (p_year, 1)
    ON CONFLICT (year) DO UPDATE SET last_seq = saisie_ef_counter.last_seq + 1
    RETURNING last_seq INTO seq;
  RETURN 'EF-' || p_year::text || '-' || lpad(seq::text, 4, '0');
END;
$$;

-- ── Dossiers de facturation saisie ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saisie_dossiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      uuid UNIQUE REFERENCES incoming_missions(id) ON DELETE SET NULL,
  ef_number       text UNIQUE,                    -- attribué à la 1ère génération d'état de frais
  -- Machine à états (pipeline facturation) :
  --   en_parc → a_facturer → ef_envoye → accepte | refuse → justinvoice
  --           → facture → gardiennage_recurrent → clos
  state           text NOT NULL DEFAULT 'en_parc',
  recipient       text NOT NULL DEFAULT 'parquet', -- parquet | domaine | client
  -- Snapshot dénormalisé (liste + PDF, robuste si la mission bouge) :
  vehicle_plate   text,
  vehicle_brand   text,
  vehicle_model   text,
  dossier_ref     text,                            -- n° PV (= incoming_missions.dossier_number)
  parked_at       date,                            -- entrée en parc (jour non compté au gardiennage)
  levee_date      date,                            -- levée de saisie
  -- Jalons facturation :
  billed_to_date  date,                            -- dernière date de gardiennage déjà facturée
  depannage_billed boolean NOT NULL DEFAULT false, -- dépannage (PEC+km) déjà facturé (1×)
  justinvoice_ref text,
  odoo_invoice_id integer,
  last_ef_at      timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saisie_dossiers_state   ON saisie_dossiers(state);
CREATE INDEX IF NOT EXISTS idx_saisie_dossiers_mission ON saisie_dossiers(mission_id);
ALTER TABLE saisie_dossiers ENABLE ROW LEVEL SECURITY;
GRANT ALL ON saisie_dossiers TO service_role;

-- ── Historique des états de frais émis ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS saisie_etats_frais (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id        uuid NOT NULL REFERENCES saisie_dossiers(id) ON DELETE CASCADE,
  numero            text NOT NULL,                 -- EF-AAAA-NNNN (suffixe -B/-C pour les suivants)
  recipient         text NOT NULL,
  period_from       date,
  period_to         date,
  include_depannage boolean NOT NULL DEFAULT false,
  total_htva        numeric(10,2),
  total_tvac        numeric(10,2),
  lines_json        jsonb,                          -- snapshot des lignes facturées
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_saisie_ef_dossier ON saisie_etats_frais(dossier_id);
ALTER TABLE saisie_etats_frais ENABLE ROW LEVEL SECURITY;
GRANT ALL ON saisie_etats_frais TO service_role;

NOTIFY pgrst, 'reload schema';
