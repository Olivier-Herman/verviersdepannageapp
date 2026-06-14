-- ============================================================
-- 202606131300_police_saisie_levee
-- ============================================================
-- Olivier 2026-06-13 — Police Saisie, Phase 2 : Levée de saisie.
--
-- Le bureau enregistre une levée de saisie (document OU commentaire) avec une
-- DATE de levée (défaut = aujourd'hui, modifiable). La levée peut être :
--   - DÉFINITIVE  : le client paie, le véhicule s'en va.
--   - TEMPORAIRE  : le véhicule part chez un garagiste puis revient en parc en
--                   attendant la levée définitive (cf Phase 3 : retour parc).
--
-- Effet : (document OU commentaire) ET date de levée  ->  police_levee_saisie_ok
-- = true (enlève le blocage police de la fiche).
--
-- GARDIENNAGE À 2 TARIFS :
--   - du jour de mise en parc JUSQU'À la date de levée = tarif Parquet/saisie
--     (ligne SERV-PARC "Gardiennage (par jour)" existante).
--   - les jours AU-DELÀ de la date de levée = tarif "hors période saisie"
--     (nouvelle ligne SERV-PARC à 20,0000 € HTVA, parc_count_from =
--     'levee_saisie_date').
-- Le split est calculé dans estimateMissionPrice (mode lines).
-- ============================================================

-- 1. Colonnes levée sur la mission
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS levee_saisie_at       TIMESTAMPTZ,                 -- date d'enregistrement
  ADD COLUMN IF NOT EXISTS levee_saisie_date     DATE,                        -- date de levée effective (modifiable) -> pilote le gardiennage
  ADD COLUMN IF NOT EXISTS levee_saisie_type     TEXT
    CHECK (levee_saisie_type IN ('definitive', 'temporaire')),
  ADD COLUMN IF NOT EXISTS levee_saisie_note     TEXT,
  ADD COLUMN IF NOT EXISTS levee_saisie_doc_path TEXT,
  ADD COLUMN IF NOT EXISTS levee_saisie_by       UUID REFERENCES public.users(id),
  -- Cycle levée TEMPORAIRE (Phase 3) : sortie vers garagiste puis retour parc.
  ADD COLUMN IF NOT EXISTS temp_garage_out_at    TIMESTAMPTZ,                 -- véhicule confié au garagiste (sorti du parc)
  ADD COLUMN IF NOT EXISTS temp_returned_at      TIMESTAMPTZ;                 -- retour en parc (départ du gardiennage hors période)
-- police_levee_saisie_ok existe déjà (migration Rodéo 202605211300) : on le
-- réutilise comme drapeau "blocage police levé".

COMMENT ON COLUMN public.incoming_missions.levee_saisie_date IS
  'Date effective de la levée de saisie (modifiable). Sépare le gardiennage Parquet (avant) du gardiennage hors période saisie (après, 20 €/j).';
COMMENT ON COLUMN public.incoming_missions.levee_saisie_type IS
  'definitive = véhicule s''en va ; temporaire = passage garagiste puis retour parc (cf temp_returned_at).';
COMMENT ON COLUMN public.incoming_missions.temp_returned_at IS
  'Levée temporaire : date de retour en parc après passage garagiste. Départ du décompte gardiennage hors période saisie (20 €/j).';

-- 2. Étend la contrainte parc_count_from pour autoriser 'levee_saisie_date'
ALTER TABLE public.source_tariff_lines
  DROP CONSTRAINT IF EXISTS source_tariff_lines_parc_count_from_check;
ALTER TABLE public.source_tariff_lines
  ADD CONSTRAINT source_tariff_lines_parc_count_from_check
  CHECK (parc_count_from IN ('parked_at', 'intervention_date', 'levee_saisie_date'));

-- 3. Ligne SERV-PARC "Gardiennage hors période saisie" — 20,0000 € HTVA/jour.
--    parc_count_from='levee_saisie_date' : comptée à partir de la date de levée
--    (ou du retour parc en cas de levée temporaire — géré dans l'estimation).
--    vehicle_class NULL = s'applique voiture ET moto (tarif unique 20 €).
--    Ajoutée aux deux grilles (2025 et 2026) pour cohérence pluriannuelle.
INSERT INTO public.source_tariff_lines (
  source, mission_type, position, kind, name,
  default_qty, default_price, apply_surcharges,
  effective_from, effective_to, vehicle_class, parc_count_from, notes
)
SELECT 'police_saisie', 'remorquage', 5, 'SERV-PARC',
       'Gardiennage hors période saisie (par jour)',
       NULL, 20.0000, false,
       v.effective_from, v.effective_to, NULL, 'levee_saisie_date',
       'Jours au-delà de la date de levée de saisie (définitive/temporaire). 20 €/jour HTVA, pas de majoration.'
FROM (VALUES
  ('2025-01-01'::date, '2025-12-31'::date),
  ('2026-01-01'::date, NULL::date)
) AS v(effective_from, effective_to)
WHERE NOT EXISTS (
  SELECT 1 FROM public.source_tariff_lines l
  WHERE l.source = 'police_saisie' AND l.mission_type = 'remorquage'
    AND l.kind = 'SERV-PARC' AND l.parc_count_from = 'levee_saisie_date'
    AND l.effective_from = v.effective_from
);

NOTIFY pgrst, 'reload schema';
