-- ============================================================
-- 202605222300_incoming_missions_departure_depot
-- ============================================================
-- Ajoute departure_depot_id sur incoming_missions : le depot depuis lequel
-- le camion part pour effectuer la mission. Selectionne par le dispatcher
-- a la creation (Pepinster par defaut). Permet :
--   - Calculs km en mode 'total' (depot -> incident -> destination -> depot)
--   - Coordination si plusieurs sites
--   - Affichage cote chauffeur (point de depart suggere)
--
-- En attendant cette migration, /api/missions/create stocke la valeur dans
-- parsed_data.departure_depot_id (jsonb). Une fois cette migration appliquee,
-- on pourra migrer le champ via UPDATE bulk si besoin.
-- ============================================================

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS departure_depot_id UUID REFERENCES public.depots(id);

CREATE INDEX IF NOT EXISTS idx_incoming_missions_departure_depot
  ON public.incoming_missions(departure_depot_id);

COMMENT ON COLUMN public.incoming_missions.departure_depot_id IS
  'Depot depuis lequel le camion part pour cette mission. Par defaut Pepinster (selection dispatcher). Sert au calcul km mode total et a la coordination multi-sites.';
