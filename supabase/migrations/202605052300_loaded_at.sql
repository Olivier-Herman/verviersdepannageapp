-- Timestamp explicite "véhicule chargé sur le camion" pour le flow REM.
-- Marque le moment où le chauffeur termine la prise en charge sur le lieu
-- d'incident et démarre le trajet vers la destination (ou un parc).
-- Distinct de on_site_at (= arrivé sur place) et delivering_at (= status update).

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ;

COMMENT ON COLUMN incoming_missions.loaded_at IS 'REM : moment ou le vehicule a ete charge sur le camion, declenche par le chauffeur';
