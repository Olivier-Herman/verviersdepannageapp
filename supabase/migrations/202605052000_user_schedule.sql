-- Plannings simples 2 plages (jour 07-20 / nuit 17-09) pour forcer le statut
-- "En service" pendant les heures de travail prevues.
-- Les 2 sont independants pour gerer les semaines de garde (jour ET nuit actives).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS schedule_day   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schedule_night BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.schedule_day   IS 'Planning de jour 07h-20h actif. Force le user en service durant ces heures.';
COMMENT ON COLUMN users.schedule_night IS 'Planning de nuit 17h-09h actif (cross-midnight). Force le user en service durant ces heures.';
