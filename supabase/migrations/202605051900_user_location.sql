-- Position GPS du chauffeur — pingee par l'app pendant les heures de travail.
-- Permet au dispatcher de voir en temps reel ou se trouve chaque chauffeur
-- et de calculer un ETA realiste vers le lieu d'intervention.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_location_lat   NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS last_location_lng   NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN users.last_location_lat   IS 'Derniere latitude pingee par l app chauffeur (foreground only)';
COMMENT ON COLUMN users.last_location_lng   IS 'Derniere longitude pingee par l app chauffeur';
COMMENT ON COLUMN users.location_updated_at IS 'Timestamp du dernier ping. >15 min => chauffeur considere comme inactif';
