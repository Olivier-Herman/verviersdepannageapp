-- Olivier 2026-05-28 : pour Mal Garee, le gardiennage commence 24h apres la
-- date d'intervention (pas a partir de la mise en parc). Pour les autres
-- sources, le compteur demarre a la mise en parc.
--
-- En plus, regle universelle : on ne compte JAMAIS le jour d'arrivee dans
-- le gardiennage. Le compteur en jours utilise Math.floor (cote code) au
-- lieu de Math.ceil — ainsi seul un jour PLEIN ecoule est facture.

-- 1. Colonne parc_count_from : reference de debut de comptage
ALTER TABLE public.source_tariff_lines
  ADD COLUMN IF NOT EXISTS parc_count_from TEXT NOT NULL DEFAULT 'parked_at'
    CHECK (parc_count_from IN ('parked_at', 'intervention_date'));

COMMENT ON COLUMN public.source_tariff_lines.parc_count_from IS
  'Reference de debut de comptage du gardiennage. parked_at (defaut, applicable a la majorite des sources) ou intervention_date (cas Mal Garee : le compteur demarre des l intervention, pas a la mise en parc). Olivier 2026-05-28.';

-- 2. Mal Garee : compteur depuis intervention_date
UPDATE public.source_tariff_lines
   SET parc_count_from = 'intervention_date'
 WHERE source = 'police_mg' AND kind = 'SERV-PARC';

NOTIFY pgrst, 'reload schema';
