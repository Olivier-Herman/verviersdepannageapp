-- ============================================================
-- 202608261400_gardiennage_intervention_types
-- ============================================================
-- Source « Gardiennage » (gardiennage pur : le vehicule entre au parc sans
-- intervention facturee — pas de PEC, pas de km). Olivier 2026-08-26.
--
-- Quatre types d intervention, qui different par le tarif jour et par le
-- point de depart du decompte :
--
--   Assistance : tarif gardiennage police (20 EUR/j HTVA, 10 EUR/j moto),
--                les 3 PREMIERS JOURS INCLUS (free_days = 3). Aucune majoration.
--   Saisie     : tarif gardiennage parquet 2026 (1,56 EUR/j voiture,
--                0,80 EUR/j cyclo), sans compter le jour d entree.
--   Siabis     : 20 EUR TVAC / jour (= 16,5289 EUR HTVA), a partir du
--                lendemain de l entree en parc.
--   Autre      : tarif gardiennage 20 EUR/j HTVA, a partir du lendemain
--                de l entree en parc.
--
-- « Sans compter le jour d entree » / « a partir du lendemain » = le
-- comportement par defaut du moteur (parc_count_from = parked_at + Math.floor
-- sur les jours pleins ecoules, cf 202605282100_parc_count_from). Rien de
-- specifique a coder : free_days = 0 suffit.
-- ============================================================

-- 1. Aucune majoration horaire sur la source (gardiennage pur).
UPDATE public.mission_source_catalog
   SET apply_surcharges = false, updated_at = now()
 WHERE key = 'gardiennage';

-- 2. Grilles (mode lines) — une par type d intervention.
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, km_inclus, km_basis,
  is_autofac, effective_from, effective_to, vehicle_class, notes
)
SELECT * FROM (VALUES
  ('gardiennage', 'assistance', 'lines', 0, 'total', false, DATE '2026-01-01', NULL::date, NULL::text,
   'Gardiennage Assistance : tarif police 20 EUR/j HTVA (10 EUR/j moto), 3 premiers jours inclus. Aucune majoration. Olivier 2026-08-26.'),
  ('gardiennage', 'saisie',     'lines', 0, 'total', false, DATE '2026-01-01', NULL::date, NULL::text,
   'Gardiennage Saisie : tarif parquet 2026 (1,56 EUR/j voiture, 0,80 EUR/j cyclo), jour d entree non compte. Olivier 2026-08-26.'),
  ('gardiennage', 'siabis',     'lines', 0, 'total', false, DATE '2026-01-01', NULL::date, NULL::text,
   'Gardiennage Siabis : 20 EUR TVAC / jour (= 16,5289 EUR HTVA), a partir du lendemain de l entree en parc. Olivier 2026-08-26.'),
  ('gardiennage', 'autre',      'lines', 0, 'total', false, DATE '2026-01-01', NULL::date, NULL::text,
   'Gardiennage Autre : 20 EUR/j HTVA a partir du lendemain de l entree en parc. Olivier 2026-08-26.')
) AS v(source, mission_type, pricing_mode, km_inclus, km_basis, is_autofac, effective_from, effective_to, vehicle_class, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs t
   WHERE t.source = 'gardiennage' AND t.mission_type = v.mission_type
);

-- 3. Lignes SERV-PARC. default_qty = NULL -> qty calculee automatiquement
--    (jours pleins ecoules depuis parked_at, moins free_days).
--    apply_surcharges = false : le gardiennage n entre jamais dans la
--    majoration horaire.
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, default_price_majore, apply_surcharges,
  effective_from, effective_to, vehicle_class, free_days, parc_count_from, notes
)
SELECT * FROM (VALUES
  -- Assistance : 3 jours inclus, voiture / moto
  ('gardiennage', 'assistance', 1, 'SERV-PARC', 'Frais de gardiennage (par jour, après 3 jours inclus)',
   NULL::numeric, 20.00::numeric, NULL::numeric, false, DATE '2026-01-01', NULL::date, 'car'::text, 3, 'parked_at',
   'Tarif gardiennage police. Les 3 premiers jours sont inclus. Aucune majoration.'),
  ('gardiennage', 'assistance', 1, 'SERV-PARC', 'Frais de gardiennage cyclo (par jour, après 3 jours inclus)',
   NULL, 10.00, NULL, false, DATE '2026-01-01', NULL, 'moto', 3, 'parked_at',
   'Tarif gardiennage police 2 roues (10 EUR/j). Les 3 premiers jours sont inclus.'),
  -- Saisie : tarif parquet, jour d entree non compte
  ('gardiennage', 'saisie', 1, 'SERV-PARC', 'Gardiennage (par jour)',
   NULL, 1.56, NULL, false, DATE '2026-01-01', NULL, 'car', 0, 'parked_at',
   'Tarif parquet 2026 voiture, 1,56 EUR/jour. Le jour d entree n est pas compte.'),
  ('gardiennage', 'saisie', 1, 'SERV-PARC', 'Gardiennage cyclo (par jour)',
   NULL, 0.80, NULL, false, DATE '2026-01-01', NULL, 'moto', 0, 'parked_at',
   'Tarif parquet 2026 cyclo, 0,80 EUR/jour. Le jour d entree n est pas compte.'),
  -- Siabis : 20 EUR TVAC / jour des le lendemain
  ('gardiennage', 'siabis', 1, 'SERV-PARC', 'Frais de gardiennage (par jour)',
   NULL, 16.5289, NULL, false, DATE '2026-01-01', NULL, NULL, 0, 'parked_at',
   '20 EUR TVAC / jour (= 16,5289 EUR HTVA), a partir du lendemain de l entree en parc.'),
  -- Autre : 20 EUR/j des le lendemain
  ('gardiennage', 'autre', 1, 'SERV-PARC', 'Frais de gardiennage (par jour)',
   NULL, 20.00, NULL, false, DATE '2026-01-01', NULL, NULL, 0, 'parked_at',
   'Gardiennage a partir du lendemain de l entree en parc.')
) AS v(source, mission_type, position, kind, name, default_qty, default_price, default_price_majore,
       apply_surcharges, effective_from, effective_to, vehicle_class, free_days, parc_count_from, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines l
   WHERE l.source = 'gardiennage'
     AND l.mission_type = v.mission_type
     AND l.kind = 'SERV-PARC'
     AND l.vehicle_class IS NOT DISTINCT FROM v.vehicle_class
);

NOTIFY pgrst, 'reload schema';
