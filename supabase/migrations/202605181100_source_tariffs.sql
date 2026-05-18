-- ============================================================
-- 202605181100_source_tariffs
-- ============================================================
-- Grille tarifaire par source d assistance (VAB, Touring, IMA, etc.)
-- × type de mission (REM, DSP, parc, etc.).
--
-- Workflow d alimentation :
--   1. Superadmin upload un PDF de tarifs via /admin/tarifs
--   2. Backend appelle Anthropic API (Claude) pour extraire les lignes
--   3. Superadmin valide / ajuste l extraction manuellement
--   4. INSERT dans source_tariffs avec snapshot du PDF (Storage)
--
-- Permission : table accessible service_role uniquement (lue par l API).
-- Pas de toggle module — c est superadmin only hardcoded.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.source_tariffs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text NOT NULL,           -- 'vab', 'touring', 'ima', 'mondial', 'ethias', etc.
  mission_type          text NOT NULL,           -- 'remorquage', 'depannage', 'parc', 'trajet_vide' (canonical lowercase)
  unit_price            numeric(10,2),           -- forfait intervention (HT)
  km_inclus             integer DEFAULT 0,       -- km gratuits inclus dans le forfait
  km_price              numeric(10,2),           -- prix par km au-dela
  parc_day_price        numeric(10,2),           -- prix par jour de mise en parc
  surcharge_night_pct   integer DEFAULT 0,       -- % surcharge nuit (ex: 50)
  surcharge_we_pct      integer DEFAULT 0,       -- % surcharge week-end
  surcharge_holiday_pct integer DEFAULT 0,       -- % surcharge jour ferie
  conditions            text,                    -- texte libre pour conditions particulieres
  is_autofac            boolean DEFAULT false,   -- l assurance facture elle-meme (pas de facture Odoo VD)
  effective_from        date NOT NULL DEFAULT CURRENT_DATE,
  effective_to          date,                    -- null = en vigueur
  source_document_path  text,                    -- chemin Storage du PDF original (bucket tariff-documents)
  source_document_name  text,                    -- nom original du fichier
  notes                 text,                    -- inclu raw_quote IA + commentaires admin
  created_by            uuid REFERENCES public.users(id),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- Index principal pour lookup tarif sur fiche mission
CREATE INDEX IF NOT EXISTS idx_source_tariffs_lookup
  ON public.source_tariffs (source, mission_type, effective_from DESC);

-- Index pour la liste UI par source
CREATE INDEX IF NOT EXISTS idx_source_tariffs_source
  ON public.source_tariffs (source);

-- RLS : service_role only (les API utilisent createAdminClient).
ALTER TABLE public.source_tariffs DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.source_tariffs TO service_role;

COMMENT ON TABLE  public.source_tariffs IS
  'Grille tarifaire negociee par source d assistance x type de mission. Aliment via extraction PDF (Claude API) + validation manuelle superadmin.';
