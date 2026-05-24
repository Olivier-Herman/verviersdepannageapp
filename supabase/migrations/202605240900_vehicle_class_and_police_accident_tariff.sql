-- ============================================================
-- 202605240900_vehicle_class_and_police_accident_tariff
-- ============================================================
-- Olivier 2026-05-24 : briefing scenario Accident (police).
--
-- 1. Ajout d un toggle Voiture/Moto sur les missions et les grilles tarif.
--    Permet d'avoir des tarifs distincts pour 4 roues et 2 roues.
--    Default 'car' (4 roues).
--
-- 2. Insertion du tarif Police Accident 4 roues en mode 'lines' :
--    - PCD  : Prise en charge degat       1 × 109.00 €
--    - TD   : Treuil degat                 2 × 86.76 €
--    - KIL  : Kilometre depart+retour depot  qty saisie × 2.20 €
--    - MOE  : Main d'œuvre depannage       1 × 60.00 €
--    - ECOPERLE                            1 × 41.33 €  (PAS soumis a majoration)
--
-- 3. Placeholder tarif 2 roues (PC + TR) : les prix seront completes
--    plus tard par Olivier via /admin/tarifs.
-- ============================================================

-- 1. Champ vehicle_class sur les missions
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS vehicle_class TEXT DEFAULT 'car' CHECK (vehicle_class IN ('car', 'moto'));

COMMENT ON COLUMN public.incoming_missions.vehicle_class IS
  'Categorie vehicule : car (4 roues, default) ou moto (2 roues). Pilote l application des grilles tarifaires distinctes (cf Police Accident PCD vs PC).';

-- 2. Champ vehicle_class sur les grilles tarif
ALTER TABLE public.source_tariffs
  ADD COLUMN IF NOT EXISTS vehicle_class TEXT;

COMMENT ON COLUMN public.source_tariffs.vehicle_class IS
  'NULL = grille applicable a tous les vehicules. ''car'' / ''moto'' = grille specifique. Si grille specifique existe pour la mission, elle prime sur la grille generique.';

CREATE INDEX IF NOT EXISTS idx_source_tariffs_vehicle_class
  ON public.source_tariffs(source, mission_type, vehicle_class);

-- 3. Tarif Police Accident — VOITURE (4 roues), mode 'lines'
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis,
  effective_from, notes
)
SELECT 'police_accident', 'remorquage', 'lines', 'car', 'total',
  CURRENT_DATE,
  'Tarif Police Accident voiture (4 roues). Brief Olivier 2026-05-24. Lignes systematiques : PCD x1 + TD x2 + KIL (qty=km totaux dep-inc-dest-dep) + MOE x1 + ECOPERLE x1 (sans majoration).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_accident'
    AND mission_type = 'remorquage'
    AND vehicle_class = 'car'
    AND effective_to IS NULL
);

-- 4. Lignes pre-configurees pour le tarif voiture
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, apply_surcharges,
  notes
) VALUES
  ('police_accident', 'remorquage', 1, 'SERV-PEC',
   'Prise en charge dégât (PCD)',
   1, 109.00, true,
   'Toujours x1 sur chaque mission Police Accident.'),

  ('police_accident', 'remorquage', 2, 'SERV-PEC',
   'Treuil dégât (TD)',
   2, 86.76, true,
   'Toujours x2 par defaut sur chaque mission Police Accident.'),

  ('police_accident', 'remorquage', 3, 'SERV-KM',
   'Kilomètre départ + retour dépôt (KIL)',
   NULL, 2.20, true,
   'qty = km totaux (depot -> incident -> destination -> retour depot). A saisir au moment du devis.'),

  ('police_accident', 'remorquage', 4, 'SERV-PEC',
   'Main d''œuvre dépannage (MOE)',
   1, 60.00, true,
   'Toujours x1 sur chaque mission Police Accident.'),

  ('police_accident', 'remorquage', 5, 'SERV-DIV',
   'Ecoperle (ECOPERLE)',
   1, 41.33, false,
   'Toujours x1. PAS soumis a majoration horaire (apply_surcharges=false).')
ON CONFLICT DO NOTHING;

-- 5. Placeholder tarif Police Accident — MOTO (2 roues) : structure prete,
-- prix a completer par Olivier via /admin/tarifs quand connus.
-- On insere une grille vide pour qu elle apparaisse deja dans l UI admin
-- avec un statut "a configurer".
INSERT INTO public.source_tariffs (
  source, mission_type, pricing_mode, vehicle_class, km_basis,
  effective_from, notes
)
SELECT 'police_accident', 'remorquage', 'lines', 'moto', 'total',
  CURRENT_DATE,
  'Tarif Police Accident moto (2 roues). Lignes : PC (au lieu de PCD) + TR (au lieu de TD) + KIL + MOE + ECOPERLE. Prix a completer par Olivier.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariffs
  WHERE source = 'police_accident'
    AND mission_type = 'remorquage'
    AND vehicle_class = 'moto'
    AND effective_to IS NULL
);

-- Note : pas de lignes inserees pour la version moto pour l instant
-- (prix non communiques). Olivier les ajoutera via l UI ou un futur script.
