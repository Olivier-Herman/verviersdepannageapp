-- Instructions chauffeur : commentaires libres saisis par le dispatch sur une
-- fiche, affichés en pop-up séquentiels quand le chauffeur ACCEPTE la mission.
-- Chaque OK du chauffeur horodate l'accusé (acknowledged_at) → visible dispatch.
-- Olivier 2026-07-10.

CREATE TABLE IF NOT EXISTS mission_driver_instructions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id       UUID NOT NULL REFERENCES incoming_missions(id) ON DELETE CASCADE,
  text             TEXT NOT NULL,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Accusé de lecture chauffeur : posé au clic « OK » du pop-up.
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Ordre d'affichage des pop-ups = ordre de création (ASC).
CREATE INDEX IF NOT EXISTS idx_mission_driver_instr_mission
  ON mission_driver_instructions(mission_id, created_at ASC);

-- Table applicative pilotée par les routes API (service_role) : RLS désactivée
-- + GRANT (cohérent avec mission_billing_remarks).
ALTER TABLE mission_driver_instructions DISABLE ROW LEVEL SECURITY;
GRANT ALL ON mission_driver_instructions TO anon, authenticated, service_role;

-- Recharge le cache de schéma PostgREST (sinon INSERT/SELECT KO tant que stale).
NOTIFY pgrst, 'reload schema';
