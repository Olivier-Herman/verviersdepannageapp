-- Info complémentaire PAR adresse (intervention / destination / relivraison),
-- visible par le chauffeur en regard de l'adresse concernée. Remplace le champ
-- global info_complementaire. Olivier 2026-06-30.
ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS incident_info    text,
  ADD COLUMN IF NOT EXISTS destination_info text,
  ADD COLUMN IF NOT EXISTS redelivery_info  text;

NOTIFY pgrst, 'reload schema';
