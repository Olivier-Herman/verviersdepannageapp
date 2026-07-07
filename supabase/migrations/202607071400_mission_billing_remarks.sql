-- Remarques de FACTURATION sur une mission — même système que mission_remarks
-- (plusieurs remarques, chacune signée + datée, éditables/supprimables) mais
-- dédiées à la facturation : rappelées en haut de la fiche et affichées + bloquées
-- au moment de facturer. Sans pièces jointes. Olivier 2026-07-07.
CREATE TABLE IF NOT EXISTS mission_billing_remarks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  UUID NOT NULL REFERENCES incoming_missions(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ,
  edit_history JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_mission_billing_remarks_mission
  ON mission_billing_remarks(mission_id, created_at DESC);

ALTER TABLE mission_billing_remarks DISABLE ROW LEVEL SECURITY;
GRANT ALL ON mission_billing_remarks TO authenticated, service_role, anon;

notify pgrst, 'reload schema';
