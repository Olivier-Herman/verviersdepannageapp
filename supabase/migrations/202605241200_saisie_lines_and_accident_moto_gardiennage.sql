-- ============================================================
-- 202605241200_saisie_lines_and_accident_moto_gardiennage
-- ============================================================
-- Olivier 2026-05-24 — prix communiques pour Saisie 2025/2026 + Accident moto.
--
-- Decisions clés :
-- 1. Distinction voiture / cyclo pour le gardiennage (+ Accident 10€ moto).
-- 2. Prix majores stockes INDEPENDAMMENT (pas calcules via +X%), car les
--    ratios reels ne sont pas exactement +50% (Olivier : "92,01 +50% ne fait
--    pas 138,03. Il faut stocker les deux differents independamment").
-- 3. Precision 4 decimales pour les prix au km (1,5374 / 2,3428 / 1,5717 / 2,3950).
-- 4. 15 km inclus dans le forfait Saisie : km_inclus=15 sur la grille.
--    estimateLinesTemplate auto-calcule qty SERV-KM = max(0, autoKm - km_inclus).
-- 5. Module Majorations existant (/admin/surcharges) determine SI la majoration
--    s applique pour cette intervention (plage horaire Saisie distincte
--    d Accident). Si oui : le code prend default_price_majore au lieu de
--    default_price. Sinon : default_price.
--    -> Pas de ligne SERV-MAJ supplementaire pour Saisie (deja integre).
-- ============================================================

-- 1. Ajout vehicle_class + default_price_majore sur source_tariff_lines
ALTER TABLE public.source_tariff_lines
  ADD COLUMN IF NOT EXISTS vehicle_class TEXT,
  ADD COLUMN IF NOT EXISTS default_price_majore NUMERIC(10,4);

-- Augmente la precision de default_price a 4 decimales (pour les prix km)
ALTER TABLE public.source_tariff_lines
  ALTER COLUMN default_price TYPE NUMERIC(10,4);

COMMENT ON COLUMN public.source_tariff_lines.vehicle_class IS
  'NULL = ligne applicable a tous. ''car''/''moto'' = ligne specifique selon mission.vehicle_class.';

COMMENT ON COLUMN public.source_tariff_lines.default_price_majore IS
  'Prix unitaire majoré stocke independamment (pas calcule via +X%). Utilise quand le module Majorations indique qu une majoration horaire s applique sur cette intervention. NULL = pas de prix majore distinct, fallback sur default_price + calcul +X%.';

CREATE INDEX IF NOT EXISTS idx_source_tariff_lines_vehicle_class
  ON public.source_tariff_lines(source, mission_type, vehicle_class);

-- 2. MAJ des grilles tarifs Saisie existantes : vehicle_class='car' + km_inclus=15
UPDATE public.source_tariffs
SET vehicle_class = 'car',
    km_inclus     = 15
WHERE source = 'police_saisie'
  AND mission_type = 'remorquage'
  AND vehicle_class IS NULL;

-- 3. Insertion grilles Saisie cyclo
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis, km_inclus,
  effective_from, effective_to, notes
)
SELECT 'police_saisie', 'remorquage', 'lines', 'moto', 'total', 15,
       '2025-01-01', '2025-12-31',
       'Tarif Saisie 2025 cyclo (2 roues).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_saisie' AND mission_type = 'remorquage'
    AND vehicle_class = 'moto' AND effective_from = '2025-01-01'
);

INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis, km_inclus,
  effective_from, notes
)
SELECT 'police_saisie', 'remorquage', 'lines', 'moto', 'total', 15,
       '2026-01-01',
       'Tarif Saisie 2026 cyclo (2 roues).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_saisie' AND mission_type = 'remorquage'
    AND vehicle_class = 'moto' AND effective_from = '2026-01-01'
    AND effective_to IS NULL
);

-- 4. Reset lignes Saisie existantes (idempotence)
DELETE FROM public.source_tariff_lines
WHERE source = 'police_saisie'
  AND mission_type = 'remorquage';

-- 5. Lignes Saisie 2025 — VOITURE
--    PEC      : 92,0100 normal / 138,0300 majoré
--    KIL      : 1,5374 normal / 2,3428 majoré (au-delà des 15 km inclus)
--    PARC     : 1,5300 / jour (pas majorable, apply_surcharges=false)
--    ADMIN    : 37,6700 (client uniquement, hors majoration)
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, default_price_majore, apply_surcharges,
  effective_from, effective_to, vehicle_class, notes
) VALUES
  ('police_saisie', 'remorquage', 1, 'SERV-PEC', 'Prise en charge (PEC)',
   1, 92.0100, 138.0300, true,
   '2025-01-01', '2025-12-31', 'car',
   'Voiture 2025. 15 km inclus. Prix majore applique selon plages /admin/surcharges Saisie.'),

  ('police_saisie', 'remorquage', 2, 'SERV-KM',  'Kilomètre au-delà des 15 km inclus',
   NULL, 1.5374, 2.3428, true,
   '2025-01-01', '2025-12-31', 'car',
   'qty = max(0, km totaux - 15). Calcule auto par estimateLinesTemplate.'),

  ('police_saisie', 'remorquage', 3, 'SERV-PARC','Gardiennage (par jour)',
   NULL, 1.5300, NULL, false,
   '2025-01-01', '2025-12-31', 'car',
   'Voiture 2025, 1.53 EUR/jour. Pas de prix majore (pas applicable au gardiennage).'),

  ('police_saisie', 'remorquage', 4, 'SERV-DIV', 'Frais administratifs (client uniquement)',
   1, 37.6700, NULL, false,
   '2025-01-01', '2025-12-31', 'car',
   'A inclure UNIQUEMENT pour les factures client. Retire pour Parquet/Domaine.');

-- 6. Lignes Saisie 2025 — CYCLO
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, default_price_majore, apply_surcharges,
  effective_from, effective_to, vehicle_class, notes
) VALUES
  ('police_saisie', 'remorquage', 1, 'SERV-PEC', 'Prise en charge (PEC) — cyclo',
   1, 92.0100, 138.0300, true,
   '2025-01-01', '2025-12-31', 'moto',
   'Cyclo 2025. PEC = meme prix que voiture.'),

  ('police_saisie', 'remorquage', 2, 'SERV-KM',  'Kilomètre au-delà des 15 km — cyclo',
   NULL, 1.5374, 2.3428, true,
   '2025-01-01', '2025-12-31', 'moto',
   'qty = max(0, km totaux - 15).'),

  ('police_saisie', 'remorquage', 3, 'SERV-PARC','Gardiennage (par jour) — cyclo',
   NULL, 0.7800, NULL, false,
   '2025-01-01', '2025-12-31', 'moto',
   'Cyclo 2025, 0.78 EUR/jour.'),

  ('police_saisie', 'remorquage', 4, 'SERV-DIV', 'Frais administratifs (client uniquement)',
   1, 37.6700, NULL, false,
   '2025-01-01', '2025-12-31', 'moto',
   'Client uniquement.');

-- 7. Lignes Saisie 2026 — VOITURE
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, default_price_majore, apply_surcharges,
  effective_from, vehicle_class, notes
) VALUES
  ('police_saisie', 'remorquage', 1, 'SERV-PEC', 'Prise en charge (PEC)',
   1, 94.0600, 141.1100, true,
   '2026-01-01', 'car', 'Voiture 2026.'),

  ('police_saisie', 'remorquage', 2, 'SERV-KM',  'Kilomètre au-delà des 15 km inclus',
   NULL, 1.5717, 2.3950, true,
   '2026-01-01', 'car', 'qty = max(0, km totaux - 15).'),

  ('police_saisie', 'remorquage', 3, 'SERV-PARC','Gardiennage (par jour)',
   NULL, 1.5600, NULL, false,
   '2026-01-01', 'car', 'Voiture 2026, 1.56 EUR/jour.'),

  ('police_saisie', 'remorquage', 4, 'SERV-DIV', 'Frais administratifs (client uniquement)',
   1, 37.6700, NULL, false,
   '2026-01-01', 'car', 'Client uniquement.');

-- 8. Lignes Saisie 2026 — CYCLO
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, default_price_majore, apply_surcharges,
  effective_from, vehicle_class, notes
) VALUES
  ('police_saisie', 'remorquage', 1, 'SERV-PEC', 'Prise en charge (PEC) — cyclo',
   1, 94.0600, 141.1100, true,
   '2026-01-01', 'moto', 'Cyclo 2026.'),

  ('police_saisie', 'remorquage', 2, 'SERV-KM',  'Kilomètre au-delà des 15 km — cyclo',
   NULL, 1.5717, 2.3950, true,
   '2026-01-01', 'moto', 'qty = max(0, km totaux - 15).'),

  ('police_saisie', 'remorquage', 3, 'SERV-PARC','Gardiennage (par jour) — cyclo',
   NULL, 0.8000, NULL, false,
   '2026-01-01', 'moto', 'Cyclo 2026, 0.80 EUR/jour.'),

  ('police_saisie', 'remorquage', 4, 'SERV-DIV', 'Frais administratifs (client uniquement)',
   1, 37.6700, NULL, false,
   '2026-01-01', 'moto', 'Client uniquement.');

-- 9. Migration des lignes Accident existantes : vehicle_class='car' par defaut
UPDATE public.source_tariff_lines
SET vehicle_class = 'car'
WHERE source = 'police_accident'
  AND mission_type = 'remorquage'
  AND vehicle_class IS NULL;

-- 10. Gardiennage Accident moto (10 EUR/jour vs 20 EUR voiture)
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, apply_surcharges,
  vehicle_class, notes
)
SELECT 'police_accident', 'remorquage', 6, 'SERV-PARC',
       'Frais de gardiennage (cyclo, par jour)',
       NULL, 10.0000, false,
       'moto',
       'Gardiennage Accident pour 2 roues : 10 EUR/jour (vs 20 EUR voiture).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines
  WHERE source = 'police_accident' AND mission_type = 'remorquage'
    AND kind = 'SERV-PARC' AND vehicle_class = 'moto'
);
