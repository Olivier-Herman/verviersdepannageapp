-- Date et heure prévues de l'intervention. Distinct de received_at (= moment
-- où la mission a été reçue par le système). Permet à un dispatcher de
-- planifier une intervention pour plus tard, ou de corriger la date inférée
-- d'un message parsé.
--
-- Backfill : les missions existantes prennent received_at comme valeur initiale,
-- afin que le tri /dispatch et les badges délai restent cohérents.

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS intervention_date TIMESTAMPTZ;

UPDATE incoming_missions
   SET intervention_date = received_at
 WHERE intervention_date IS NULL
   AND received_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_intervention_date
  ON incoming_missions (intervention_date DESC NULLS LAST);

COMMENT ON COLUMN incoming_missions.intervention_date IS 'Date et heure prevues de l intervention. Default = received_at au backfill. Modifiable via UI dispatch.';
