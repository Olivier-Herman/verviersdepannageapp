-- ============================================================
-- 202605251600_police_mg_rodeo_avp_tariffs
-- ============================================================
-- Olivier 2026-05-25 : les tarifs police_mg / police_rodeo / police_avp
-- existaient seulement HARDCODES dans restitute/route.ts (workflow
-- restitution Mal Garee) :
--   - forfait HTVA  : 165.29 EUR (= 200 EUR TVAC)
--   - codes Odoo    : PECMG / PECRODEO / PECAVP
--   - gardiennage   : 20 EUR/jour (commun a tous)
--   - rodeo specifique : min 3 jours de gardiennage factures
--
-- Mais jamais portes dans source_tariffs -> le calculateur unifie
-- estimateMissionPrice renvoyait "Aucun tarif police_mg/remorquage en
-- vigueur" depuis le formulaire dispatch + fiche mission.
--
-- Cette migration porte ces tarifs en mode 'lines' coherent avec le
-- pattern police_accident / police_saisie. Pas de distinction car/moto
-- pour MG/Rodeo/AVP (Olivier 2026-05-21 : tarif identique).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. police_mg (Mal Garee)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis,
  effective_from, notes
)
SELECT 'police_mg', 'remorquage', 'lines', NULL, 'total',
       CURRENT_DATE,
       'Tarif Mal Garee : forfait fixe 165.29 EUR HTVA (= 200 EUR TVAC) + gardiennage 20 EUR/jour. Pas de majoration horaire (apply_surcharges=false dans catalog).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_mg' AND mission_type = 'remorquage'
    AND effective_to IS NULL
);

-- Lignes police_mg
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, apply_surcharges, notes
)
SELECT * FROM (VALUES
  ('police_mg', 'remorquage', 1, 'SERV-PEC',
   'Forfait enlèvement Mal Garée (PECMG)',
   1::numeric, 165.29::numeric, false,
   'Code Odoo: PECMG. = 200 EUR TVAC. Pas de majoration horaire.'),
  ('police_mg', 'remorquage', 2, 'SERV-PARC',
   'Frais de gardiennage (par jour)',
   NULL::numeric, 20.00::numeric, false,
   'Code Odoo: GARDIENNAGE. EUR/jour. qty calculee auto (jours en parc).')
) AS t(source, mission_type, position, kind, name, default_qty, default_price, apply_surcharges, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines
  WHERE source = 'police_mg' AND mission_type = 'remorquage'
);

-- ─────────────────────────────────────────────────────────────
-- 2. police_rodeo
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis,
  effective_from, notes
)
SELECT 'police_rodeo', 'remorquage', 'lines', NULL, 'total',
       CURRENT_DATE,
       'Tarif Rodeo : forfait fixe 165.29 EUR HTVA + gardiennage 20 EUR/jour. MIN 3 jours gardiennage factures (default_qty=3 par defaut, ajustable par le code restitute).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_rodeo' AND mission_type = 'remorquage'
    AND effective_to IS NULL
);

-- Lignes police_rodeo
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, apply_surcharges, notes
)
SELECT * FROM (VALUES
  ('police_rodeo', 'remorquage', 1, 'SERV-PEC',
   'Forfait enlèvement Rodéo (PECRODEO)',
   1::numeric, 165.29::numeric, false,
   'Code Odoo: PECRODEO.'),
  ('police_rodeo', 'remorquage', 2, 'SERV-PARC',
   'Frais de gardiennage (par jour, min 3)',
   3::numeric, 20.00::numeric, false,
   'Code Odoo: GARDIENNAGE. Min 3 jours factures (default_qty=3). Code restitute prend max(3, days_actual).')
) AS t(source, mission_type, position, kind, name, default_qty, default_price, apply_surcharges, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines
  WHERE source = 'police_rodeo' AND mission_type = 'remorquage'
);

-- ─────────────────────────────────────────────────────────────
-- 3. police_avp (Abandon Voie Publique)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis,
  effective_from, notes
)
SELECT 'police_avp', 'remorquage', 'lines', NULL, 'total',
       CURRENT_DATE,
       'Tarif AVP : forfait fixe 165.29 EUR HTVA (= 200 EUR TVAC, identique MG) + gardiennage 20 EUR/jour.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_avp' AND mission_type = 'remorquage'
    AND effective_to IS NULL
);

-- Lignes police_avp
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, apply_surcharges, notes
)
SELECT * FROM (VALUES
  ('police_avp', 'remorquage', 1, 'SERV-PEC',
   'Forfait enlèvement AVP (PECAVP)',
   1::numeric, 165.29::numeric, false,
   'Code Odoo: PECAVP.'),
  ('police_avp', 'remorquage', 2, 'SERV-PARC',
   'Frais de gardiennage (par jour)',
   NULL::numeric, 20.00::numeric, false,
   'Code Odoo: GARDIENNAGE. EUR/jour.')
) AS t(source, mission_type, position, kind, name, default_qty, default_price, apply_surcharges, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines
  WHERE source = 'police_avp' AND mission_type = 'remorquage'
);
