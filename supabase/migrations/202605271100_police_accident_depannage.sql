-- ============================================================
-- 202605271100_police_accident_depannage
-- ============================================================
-- Olivier 2026-05-27 : tarif Police Accident pour DSP (depannage sur place).
-- Avant : "Aucun tarif police_accident/depannage en vigueur" -> bandeau erreur
-- pour les Appel Prive DSP (qui utilise le fallback police_accident).
--
-- Regle : meme calcul que REM mais SANS 2xTD (pas de chargement vehicule
-- puisque depanne sur place) et SANS ECOPERLE.
--
-- Lignes pour police_accident / depannage :
--   - PCD x1 (109.00)         identique a REM
--   - KIL × qty (2.20)        identique a REM
--   - MOE x1 (60.00)          identique a REM
--   (pas de TD x2)            <- difference 1
--   (pas de ECOPERLE)         <- difference 2
-- ============================================================

INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis,
  effective_from, notes
)
SELECT 'police_accident', 'depannage', 'lines', 'car', 'total',
  CURRENT_DATE,
  'Tarif Police Accident DSP (depannage sur place, 4 roues). Olivier 2026-05-27. Lignes : PCD x1 + KIL (qty=km totaux) + MOE x1. Pas de TD (pas de chargement) ni ECOPERLE.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_accident'
    AND mission_type = 'depannage'
    AND vehicle_class = 'car'
    AND effective_to IS NULL
);

-- Lignes pre-configurees pour DSP voiture
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, apply_surcharges,
  notes
)
SELECT * FROM (VALUES
  ('police_accident'::text, 'depannage'::text, 1, 'SERV-PEC'::text,
   'Prise en charge degat (PCD)'::text,
   1::numeric, 109.00::numeric, true,
   'Toujours x1. Identique au tarif Remorquage.'::text),

  ('police_accident', 'depannage', 2, 'SERV-KM',
   'Kilometre depart + retour depot (KIL)',
   NULL::numeric, 2.20, true,
   'qty saisie a la facturation = km totaux (depot -> incident -> retour depot).'),

  ('police_accident', 'depannage', 3, 'SERV-DIV',
   'Main d oeuvre depannage (MOE)',
   1::numeric, 60.00, true,
   'Toujours x1.')
) AS t(source, mission_type, position, kind, name, default_qty, default_price, apply_surcharges, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines
  WHERE source = 'police_accident' AND mission_type = 'depannage'
);

NOTIFY pgrst, 'reload schema';
