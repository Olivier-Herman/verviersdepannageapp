-- Domaine (État) : date d'enlèvement du véhicule (sortie physique du parc).
-- Le gardiennage facturé à l'État = remise Domaine → date d'enlèvement (incluse).
-- La date de vente sert à déterminer le trimestre d'apparition. Olivier 2026-06-29.
ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS domaine_enlevement_date date;

NOTIFY pgrst, 'reload schema';
