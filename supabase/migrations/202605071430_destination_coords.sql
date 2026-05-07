-- Coordonnées de la destination de remorquage (REM).
-- Symétrique avec incident_lat/incident_lng (lieu d'incident).
-- Colonnes implicitement attendues par /api/missions/[id]/km,
-- /relivrer et le silentPatch de MissionDetailClient mais jamais
-- créées historiquement (oubli, cf. commentaire workaround dans
-- /km/route.ts:41 "SELECT * pour être robuste aux colonnes manquantes").

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS destination_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS destination_lng NUMERIC;

COMMENT ON COLUMN incoming_missions.destination_lat IS 'Latitude de la destination de remorquage. Symetrique avec incident_lat. Nullable.';

COMMENT ON COLUMN incoming_missions.destination_lng IS 'Longitude de la destination de remorquage. Symetrique avec incident_lng. Nullable.';
