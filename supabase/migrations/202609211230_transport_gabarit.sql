-- ============================================================
-- 202609211230_transport_gabarit
-- ============================================================
-- Grille tarifaire des TRANSPORTS (rapatriements) par GABARIT de véhicule.
-- Olivier 21/09/2026 (grille par gabarit, préalable robot transports).
--
-- Règle métier (cf mémoire project_transport_rapatriement_phase) :
--   • mission_type = 'transport' = prise en charge et/ou dépose HORS Belgique
--     (dossiers Touring 2026BX…, mails assisteurs) ;
--   • prix HTVA = prix/km HTVA × km ALLER-RETOUR depuis le dépôt (boucle
--     dépôt → prise en charge → arrêts → dépose → dépôt, computeMissionKm
--     totalKm) ; pas de forfait, pas de prise en charge ;
--   • le prix/km dépend de la SOURCE et du GABARIT du véhicule :
--       voiture · monospace · l1h1 (camionnette L1/H1) · l2h2 (camionnette L2/H2)
--     + « autre » = prix/km HTVA saisi à la main sur la fiche.
--
-- Pourquoi une table dédiée et pas source_tariffs : source_tariffs modélise
-- forfait + km inclus + tranches + lignes préconfigurées, avec périodes de
-- validité et PDF source — rien de tout cela ne s'applique ici, et l'écran
-- /admin/tarifs laisserait saisir des champs que le moteur transport ignore.
-- La grille transport est un simple tableau source × gabarit → prix/km.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transport_tariffs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key         text NOT NULL,                       -- clé mission_source_catalog (touring, mondial, vab, axa, kaze…)
  vehicle_category   text NOT NULL
                     CHECK (vehicle_category IN ('voiture', 'monospace', 'l1h1', 'l2h2')),
  price_per_km_htva  numeric(10,4) NOT NULL CHECK (price_per_km_htva >= 0),  -- 4 décimales (précision Odoo « Product Price »)
  active             boolean NOT NULL DEFAULT true,
  notes              text,
  created_by         uuid REFERENCES public.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_key, vehicle_category)
);

CREATE INDEX IF NOT EXISTS idx_transport_tariffs_source
  ON public.transport_tariffs (source_key);

-- Lue/écrite uniquement par les routes API (service_role), comme source_tariffs.
ALTER TABLE public.transport_tariffs DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.transport_tariffs TO service_role;

COMMENT ON TABLE public.transport_tariffs IS
  'Grille transport / rapatriement : prix au km HTVA par source × gabarit de véhicule (voiture, monospace, l1h1, l2h2). Le gabarit « autre » n''a pas de ligne : prix/km saisi sur la fiche (incoming_missions.transport_price_per_km_htva). Olivier 21/09/2026.';
COMMENT ON COLUMN public.transport_tariffs.price_per_km_htva IS
  'Prix HTVA par km, appliqué aux km aller-retour depuis le dépôt (computeMissionKm totalKm).';

-- Fiche : gabarit choisi par le dispatch + prix/km manuel pour « autre ».
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS transport_vehicle_category text
    CHECK (transport_vehicle_category IN ('voiture', 'monospace', 'l1h1', 'l2h2', 'autre')),
  ADD COLUMN IF NOT EXISTS transport_price_per_km_htva numeric(10,4)
    CHECK (transport_price_per_km_htva IS NULL OR transport_price_per_km_htva >= 0);

COMMENT ON COLUMN public.incoming_missions.transport_vehicle_category IS
  'Transport / rapatriement : gabarit du véhicule (voiture, monospace, l1h1, l2h2, autre). NULL = à choisir → pas de montant, la fiche reste « à calculer ».';
COMMENT ON COLUMN public.incoming_missions.transport_price_per_km_htva IS
  'Transport / rapatriement, gabarit « autre » uniquement : prix/km HTVA convenu, saisi à la main. Ignoré (remis à NULL) pour les autres gabarits.';

NOTIFY pgrst, 'reload schema';
