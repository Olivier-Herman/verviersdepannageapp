-- ============================================================
-- 202605201400_source_tariff_lines
-- ============================================================
-- Nouveau mode de tarification "lines" pour les sources qui ont un set
-- de lignes pre-configurees plutot qu un forfait + km supp ou des tranches.
--
-- Exemple : Appel Police Accident
--   - SERV-PEC "Prise en charge Police" : 1 × 50 €
--   - SERV-PEC "Treuil Degat"           : 1 × 80 €
--   - SERV-PEC "Main d oeuvre"          : N × 60 €/h
--   - SERV-KM  "Kilometre"              : N × 1.50 €/km
--   - SERV-DIV "Frais administratifs"   : 1 × 15 €
--
-- Au moment de la facturation : l app charge ces lignes pre-configurees,
-- l employe ajuste qty/PU/description avant push Odoo. La ligne SERV-MAJ
-- est ajoutee automatiquement via getApplicableSurcharges (matrice
-- surcharges existante).
-- ============================================================

-- 1. Extension du check pricing_mode pour inclure 'lines'
ALTER TABLE public.source_tariffs DROP CONSTRAINT IF EXISTS source_tariffs_pricing_mode_check;
ALTER TABLE public.source_tariffs
  ADD CONSTRAINT source_tariffs_pricing_mode_check
  CHECK (pricing_mode IN ('forfait', 'brackets', 'lines'));

-- 2. Table des lignes pre-configurees
CREATE TABLE IF NOT EXISTS public.source_tariff_lines (
  id                bigserial PRIMARY KEY,
  source            text NOT NULL,
  mission_type      text NOT NULL,
  position          int NOT NULL DEFAULT 0,  -- ordre d affichage dans le devis
  kind              text NOT NULL CHECK (kind IN ('SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV')),
  name              text NOT NULL,           -- description par defaut (modifiable par l employe)
  default_qty       numeric(10, 4),          -- qty pre-remplie (null = a saisir)
  default_price     numeric(10, 2),          -- PU pre-rempli (null = a saisir)
  apply_surcharges  boolean NOT NULL DEFAULT true,  -- inclure dans le subtotal majorable
  effective_from    date NOT NULL DEFAULT CURRENT_DATE,
  effective_to      date,
  notes             text,
  created_by        uuid REFERENCES public.users(id),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_tariff_lines_lookup
  ON public.source_tariff_lines (source, mission_type, effective_from DESC, position);

ALTER TABLE public.source_tariff_lines DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.source_tariff_lines TO service_role;
GRANT USAGE, SELECT ON SEQUENCE source_tariff_lines_id_seq TO service_role;

COMMENT ON TABLE public.source_tariff_lines IS
  'Lignes pre-configurees par source d assistance x type mission. Active si source_tariffs.pricing_mode = lines.';

COMMENT ON COLUMN public.source_tariff_lines.position IS
  'Ordre d affichage des lignes dans l editeur de devis (0 = premier).';
COMMENT ON COLUMN public.source_tariff_lines.default_qty IS
  'Quantite pre-remplie (l employe ajuste lors de la facturation). Null si totalement variable.';
COMMENT ON COLUMN public.source_tariff_lines.default_price IS
  'Prix unitaire pre-rempli. Null si negocie par intervention.';
COMMENT ON COLUMN public.source_tariff_lines.apply_surcharges IS
  'True = inclure dans le subtotal pour le calcul de la majoration horaire (ligne SERV-MAJ auto).';
