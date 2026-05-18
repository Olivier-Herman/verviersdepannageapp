-- supabase/migrations/202605181600_mission_remarks.sql
--
-- Remarques annotées sur les missions, avec pièces jointes.
-- - Éditables par tous les dispatchers (les modifications sont historisées
--   dans edit_history JSONB)
-- - Plusieurs fichiers par remarque (table mission_remark_attachments)
-- - Fichiers stockés dans bucket Storage "mission-remarks" (privé)

CREATE TABLE IF NOT EXISTS mission_remarks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  UUID NOT NULL REFERENCES incoming_missions(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ,
  edit_history JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_mission_remarks_mission ON mission_remarks(mission_id, created_at DESC);

ALTER TABLE mission_remarks DISABLE ROW LEVEL SECURITY;
GRANT ALL ON mission_remarks TO authenticated, service_role, anon;

CREATE TABLE IF NOT EXISTS mission_remark_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remark_id   UUID NOT NULL REFERENCES mission_remarks(id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,           -- chemin dans le bucket
  file_name   TEXT NOT NULL,           -- nom original (display)
  file_size   BIGINT NOT NULL DEFAULT 0,
  mime_type   TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mission_remark_attach_remark ON mission_remark_attachments(remark_id);

ALTER TABLE mission_remark_attachments DISABLE ROW LEVEL SECURITY;
GRANT ALL ON mission_remark_attachments TO authenticated, service_role, anon;

-- Bucket Storage privé (l'app fournit des signed URLs via API)
INSERT INTO storage.buckets (id, name, public)
VALUES ('mission-remarks', 'mission-remarks', false)
ON CONFLICT (id) DO NOTHING;
