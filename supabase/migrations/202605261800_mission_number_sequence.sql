-- Olivier 2026-05-26 : numero de mission lisible (8 chiffres, demarre a 10000000).
-- Garde id UUID comme cle technique (FK Odoo / TowSoft / integrations inchangees).
-- Ajoute incoming_missions.mission_number BIGINT UNIQUE, alimente automatiquement
-- via sequence Postgres a chaque insert. Affiche dans l UI a la place de external_id
-- (lecture humaine / dictation au tel / copie Slack).

CREATE SEQUENCE IF NOT EXISTS mission_number_seq
  START WITH 10000000
  INCREMENT BY 1
  MINVALUE 10000000
  NO CYCLE;

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS mission_number BIGINT;

-- Backfill chronologique pour les missions existantes : ordre created_at,
-- demarre a 10000000 (les anciennes deviennent les plus petits numeros).
UPDATE incoming_missions
   SET mission_number = sub.num
  FROM (
    SELECT id, 9999999 + ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS num
      FROM incoming_missions
     WHERE mission_number IS NULL
  ) sub
 WHERE incoming_missions.id = sub.id;

-- Realigne la sequence sur le max actuel (les prochains INSERT recoivent
-- max+1, jamais de collision avec les numeros backfilles).
SELECT setval(
  'mission_number_seq',
  GREATEST((SELECT COALESCE(MAX(mission_number), 9999999) FROM incoming_missions), 9999999)
);

-- A partir de maintenant : chaque INSERT recoit son numero automatiquement.
ALTER TABLE incoming_missions
  ALTER COLUMN mission_number SET DEFAULT nextval('mission_number_seq');

ALTER TABLE incoming_missions
  ALTER COLUMN mission_number SET NOT NULL;

-- Index unique pour lookup rapide via /dispatch/[number] et garde-fou collision.
CREATE UNIQUE INDEX IF NOT EXISTS incoming_missions_mission_number_uniq
  ON incoming_missions (mission_number);

-- Commentaire pour memo Supabase Studio.
COMMENT ON COLUMN incoming_missions.mission_number IS
  'Numero de mission lisible (8 chiffres). Affiche dans UI, route /dispatch/[number]. Sequence demarre a 10000000.';
