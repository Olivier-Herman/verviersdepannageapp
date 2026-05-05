-- Lien parent -> enfant pour les missions de relivraison auto-créées.
-- Quand un chauffeur dépose un véhicule en parc au lieu de l'emmener à
-- destination, on crée une mission REL avec parent_mission_id = id de la
-- mission de remorquage initiale. La REL aura :
--   - incident = parc (où est le véhicule)
--   - destination = adresse originale de la mission parent

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS parent_mission_id UUID REFERENCES incoming_missions(id) ON DELETE SET NULL;

COMMENT ON COLUMN incoming_missions.parent_mission_id IS 'Mission parente — ex: REL auto-creee depuis une REM avec mise en parc';

CREATE INDEX IF NOT EXISTS idx_incoming_missions_parent ON incoming_missions(parent_mission_id);
