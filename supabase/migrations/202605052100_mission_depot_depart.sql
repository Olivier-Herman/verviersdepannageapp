-- Lien dépôt de départ pour le calcul des KM aller/retour mission.
-- Le dispatcher choisit le dépôt depuis lequel le chauffeur partira.
-- Valeur par défaut côté UI = depots.is_default = true (Pépinster)

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS depot_depart_id UUID REFERENCES depots(id);

COMMENT ON COLUMN incoming_missions.depot_depart_id IS 'Depot de depart du chauffeur, defaut = depots.is_default (Pepinster). Sert au calcul KM facturable.';
