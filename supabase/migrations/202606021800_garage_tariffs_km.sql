-- Olivier 2026-06-02 : structure tarifaire garage = prise en charge + km
-- (aligne sur pattern source_tariffs). 3 valeurs par type d intervention
-- (DSP, REM, DPR) :
--   - prise_en_charge : forfait fixe TVAC
--   - km_inclus       : nombre de km couverts par le forfait
--   - km_price        : prix TVAC par km au-dela
--
-- DPR garde le fallback DSP si non defini.

-- Renommage des colonnes existantes (qui etaient des prix simples) en
-- prise_en_charge (premiere valeur de la nouvelle structure).
ALTER TABLE public.garage_tariffs
  RENAME COLUMN dsp_price TO dsp_prise_en_charge;
ALTER TABLE public.garage_tariffs
  RENAME COLUMN rem_price TO rem_prise_en_charge;
ALTER TABLE public.garage_tariffs
  RENAME COLUMN dpr_price TO dpr_prise_en_charge;

-- Ajout des 6 nouvelles colonnes (km inclus + prix km par type)
ALTER TABLE public.garage_tariffs
  ADD COLUMN IF NOT EXISTS dsp_km_inclus int           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dsp_km_price  numeric(10,2),
  ADD COLUMN IF NOT EXISTS rem_km_inclus int           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rem_km_price  numeric(10,2),
  ADD COLUMN IF NOT EXISTS dpr_km_inclus int           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dpr_km_price  numeric(10,2);

COMMENT ON COLUMN public.garage_tariffs.dsp_prise_en_charge IS
  'Forfait fixe TVAC d une intervention DSP (depannage sur place).';
COMMENT ON COLUMN public.garage_tariffs.dsp_km_inclus IS
  'Nombre de km couverts par dsp_prise_en_charge.';
COMMENT ON COLUMN public.garage_tariffs.dsp_km_price IS
  'Prix TVAC par km au dela de dsp_km_inclus.';

NOTIFY pgrst, 'reload schema';
