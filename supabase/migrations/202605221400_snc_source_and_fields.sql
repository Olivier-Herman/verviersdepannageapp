-- ============================================================
-- 202605221400_snc_source_and_fields
-- ============================================================
-- 4eme type fourriere police : SNC (Siabis Non Couvert)
-- = Requisition police pour intervention sur autoroute (panne ou accident).
--
-- 3 scenarios :
--   - dsp        : depannage sur place, paiement client + encaissement chauffeur
--   - rem_client : remorquage avec paiement immediat par client (livraison directe)
--   - rem_depot  : remorquage vers Pepinster, zone Transit, gestion ulterieure
--                  au bureau (paiement + relivraison/abandon/reprise assistance)
--
-- Tarification :
--   - Sans balisage : SIAREM 161.98 + SIAKIL 1.0744/km
--   - Avec balisage : SIAREM + SIAKIL + SIABAL 150
--   - Si plage horaire majoree : PECSIAMAJ 242.98 + SIAKILMAJ 1.65 + SIABALMAJ 175.21
--   - Plages majoration : configurees dans /admin/surcharges avec 0% (drapeau seulement)
-- ============================================================

-- 1. Source au catalog
INSERT INTO public.mission_source_catalog (key, label, sort_order)
VALUES ('police_snc', 'Police - SNC (Siabis Non Couvert)', 43)
ON CONFLICT (key) DO NOTHING;

-- 2. Champs SNC sur incoming_missions
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS snc_requires_balisage BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS snc_scenario TEXT
    CHECK (snc_scenario IS NULL OR snc_scenario IN ('dsp', 'rem_client', 'rem_depot')),
  ADD COLUMN IF NOT EXISTS snc_depart_depot TEXT
    CHECK (snc_depart_depot IS NULL OR snc_depart_depot IN ('pepinster', 'aywaille')),
  ADD COLUMN IF NOT EXISTS snc_km_total INTEGER,        -- km totaux depanneuse (depart + intervention + retour)
  ADD COLUMN IF NOT EXISTS snc_km_balisage INTEGER;     -- km balisage (toujours retour depot apres intervention)

COMMENT ON COLUMN public.incoming_missions.snc_requires_balisage IS
  'SNC : intervention necessite un vehicule de securite/balisage avant.';
COMMENT ON COLUMN public.incoming_missions.snc_scenario IS
  'SNC : scenario d intervention. dsp=depannage place / rem_client=REM paye sur place / rem_depot=REM vers Pepinster pour gestion au bureau.';
COMMENT ON COLUMN public.incoming_missions.snc_depart_depot IS
  'SNC : depot d origine de la depanneuse. pepinster ou aywaille (le plus proche du lieu d intervention).';
COMMENT ON COLUMN public.incoming_missions.snc_km_total IS
  'SNC : kilometres totaux parcourus par la depanneuse (calcul auto Google Maps).';
COMMENT ON COLUMN public.incoming_missions.snc_km_balisage IS
  'SNC : kilometres du vehicule de balisage (depot -> lieu -> depot, ne suit pas la depanneuse en REM).';
