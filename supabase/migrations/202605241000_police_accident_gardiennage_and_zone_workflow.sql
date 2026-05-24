-- ============================================================
-- 202605241000_police_accident_gardiennage_and_zone_workflow
-- ============================================================
-- 1. Ajoute la ligne de gardiennage (SERV-PARC, 20 EUR/jour) au tarif
--    Police Accident voiture (oubli du brief Olivier 2026-05-24).
--
-- 2. La quantite (jours en parc) est calculee automatiquement par
--    estimateLinesTemplate (cf modif lib/missions/estimate-price.ts)
--    a partir du champ incoming_missions.parked_at.
--
-- 3. Le prix unitaire (20 EUR) est modifiable via /admin/tarifs si
--    Olivier veut le changer plus tard.
-- ============================================================

-- Ajout de la ligne gardiennage au tarif voiture
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, apply_surcharges,
  notes
)
SELECT 'police_accident', 'remorquage', 6, 'SERV-PARC',
       'Frais de gardiennage (par jour)',
       NULL, 20.00, false,
       'qty = nombre de jours depuis parked_at (calcule automatiquement). Pas soumis a majoration horaire. Modifiable via /admin/tarifs.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines
  WHERE source = 'police_accident'
    AND mission_type = 'remorquage'
    AND kind = 'SERV-PARC'
    AND effective_to IS NULL
);

-- (Idem pour la grille moto : sera ajoutee quand les prix moto seront connus)
