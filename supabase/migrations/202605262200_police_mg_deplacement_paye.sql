-- 202605262200_police_mg_deplacement_paye
-- Olivier 2026-05-26 : nouveau scenario Mal Garee "Deplacement avec paiement".
-- Cas : chauffeur arrive sur place mais le client se pointe AVANT chargement.
-- Le vehicule n'est pas charge, le deplacement est paye directement au chauffeur.
-- Forfait fixe : 125 EUR TVAC = 103.31 EUR HTVA.
--
-- Mission_type utilise : 'trajet_vide' (DPR) car pas de chargement effectif.
-- Workflow : in_progress (pas de mise en parc), encaissement direct chauffeur,
-- cloture via clic "Terminer" → to_invoice → module facturation.

-- ─────────────────────────────────────────────────────────────
-- Tarif police_mg + trajet_vide = forfait Deplacement Mal Garee
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis,
  effective_from, notes
)
SELECT 'police_mg', 'trajet_vide', 'lines', NULL, 'total',
       CURRENT_DATE,
       'Tarif Mal Garee deplacement avec paiement : forfait 103.31 EUR HTVA (= 125 EUR TVAC). Client arrive avant chargement et paye le deplacement.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_mg' AND mission_type = 'trajet_vide'
    AND effective_to IS NULL
);

-- Ligne unique : forfait deplacement
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, apply_surcharges, notes
)
SELECT * FROM (VALUES
  ('police_mg', 'trajet_vide', 1, 'SERV-DIV',
   'Forfait deplacement Mal Garee (client arrive avant chargement)',
   1::numeric, 103.31::numeric, false,
   'Code Odoo Divers. = 125 EUR TVAC. Pas de majoration horaire.')
) AS t(source, mission_type, position, kind, name, default_qty, default_price, apply_surcharges, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines
  WHERE source = 'police_mg' AND mission_type = 'trajet_vide'
);

NOTIFY pgrst, 'reload schema';
