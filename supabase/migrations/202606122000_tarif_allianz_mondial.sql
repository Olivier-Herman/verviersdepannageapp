-- supabase/migrations/202606122000_tarif_allianz_mondial.sql
--
-- Olivier 2026-06-12 : grille tarifaire Allianz / AWP (source 'mondial').
-- Tarifs IDENTIQUES pour tous les produits du groupe Allianz, AUCUNE majoration
-- (soir / week-end / jour férié). Dérivés de 35 clôtures réelles.
--
-- Utilisée par :
--   - l autoclôture Allianz (src/lib/allianz/closure.ts → loadAllianzRates)
--   - l estimation de prix sur les fiches (estimateMissionPrice)
--
-- Structure des lignes de devis Allianz :
--   Remorquage (T)      = Fuel compensation (3,50) + Remorquage sans réparation (97,02) + Supplément distance
--   Réparé sur place (R)= Fuel compensation (3,50) + Réparé sur place (140,27)          + Supplément distance
--   Supplément distance = (distance − 50 km inclus) × 1,40 €/km
--
-- 'fuel' = pseudo mission_type portant le forfait Fuel compensation (ligne ajoutée
-- à chaque clôture). is_autofac=true : Allianz facture elle-même.

INSERT INTO public.source_tariffs
  (source, mission_type, unit_price, km_inclus, km_price, surcharge_night_pct, surcharge_we_pct, surcharge_holiday_pct, is_autofac, notes)
SELECT v.source, v.mission_type, v.unit_price, v.km_inclus, v.km_price, 0, 0, 0, true, v.notes
FROM (VALUES
  ('mondial', 'remorquage',  97.02::numeric, 50, 1.40::numeric, 'Allianz/AWP — Remorquage sans réparation. 50 km inclus, 1,40 €/km, aucune majoration.'),
  ('mondial', 'depannage',  140.27::numeric, 50, 1.40::numeric, 'Allianz/AWP — Réparé sur place. 50 km inclus, 1,40 €/km, aucune majoration.'),
  ('mondial', 'fuel',         3.50::numeric,  0, 0.00::numeric, 'Allianz/AWP — Fuel compensation (forfait fixe ajouté à chaque clôture).')
) AS v(source, mission_type, unit_price, km_inclus, km_price, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs st
  WHERE st.source = v.source AND st.mission_type = v.mission_type AND st.effective_to IS NULL
);

NOTIFY pgrst, 'reload schema';
