-- 202608101100_touring_missing_since
--
-- Surveillance annulation Touring : une mission COMEX disparue de listComexMissions
-- (Touring l'a annulée/réattribuée si non validée à temps). On horodate la 1re
-- disparition ; après une fenêtre de confirmation, on tranche (règle « Mondial » :
-- non partie = sans frais ; partie = déplacement/trajet à vide). Olivier 2026-08-09.

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS touring_missing_since timestamptz;

NOTIFY pgrst, 'reload schema';
