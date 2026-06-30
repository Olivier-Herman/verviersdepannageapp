-- Info complémentaire pour le chauffeur (sous les adresses intervention /
-- destination / relivraison). Olivier 2026-06-30.
ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS info_complementaire text;

NOTIFY pgrst, 'reload schema';
