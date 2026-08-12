-- Lien vers la mission go&assist (AXA) pour les fiches créées côté VD Soft
-- (mail ou poll). L'external_id est déjà pris (id du mail) → colonne dédiée.
-- Sert d'INTERRUPTEUR : présent = mission suivie/pilotée dans go&assist
-- (valider/affecter/clôturer) ; absent = pas dans go&assist → clôture VD Soft pure.
-- Olivier 2026-08-13.

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS axa_mission_order_id text;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_axa_moid
  ON incoming_missions (axa_mission_order_id)
  WHERE axa_mission_order_id IS NOT NULL;
