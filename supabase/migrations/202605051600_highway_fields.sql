-- Champs autoroute pour incoming_missions :
-- Borne kilométrique + sens de circulation, applicables au lieu d'incident
-- ET à la destination (cas où le véhicule est emmené sur une autoroute,
-- ou prise en charge sur autoroute).
--
-- Stockés en TEXT car borne km peut être "132.5" ou "132+200" (notation belge),
-- et le sens est une direction libre type "Liège" ou "Bruxelles".

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS incident_borne_km    TEXT,
  ADD COLUMN IF NOT EXISTS incident_sens        TEXT,
  ADD COLUMN IF NOT EXISTS destination_borne_km TEXT,
  ADD COLUMN IF NOT EXISTS destination_sens     TEXT;

COMMENT ON COLUMN incoming_missions.incident_borne_km    IS 'Borne kilométrique du lieu d intervention (autoroutes uniquement)';
COMMENT ON COLUMN incoming_missions.incident_sens        IS 'Sens de circulation (autoroutes), ex: Liège, Bruxelles';
COMMENT ON COLUMN incoming_missions.destination_borne_km IS 'Borne kilométrique de la destination (autoroutes uniquement)';
COMMENT ON COLUMN incoming_missions.destination_sens     IS 'Sens de circulation (autoroutes), ex: Liège, Bruxelles';
