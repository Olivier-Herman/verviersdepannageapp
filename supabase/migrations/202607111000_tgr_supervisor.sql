-- Supervision TGR (responsable Touring) : jeton STABLE révocable → page publique
-- lecture seule (/superv/tgr?token=…) + email mensuel de bilan. Olivier 2026-07-11.

CREATE TABLE IF NOT EXISTS tgr_supervisor_tokens (
  token       text PRIMARY KEY,
  label       text,
  revoked     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tgr_supervisor_tokens DISABLE ROW LEVEL SECURITY;
GRANT ALL ON tgr_supervisor_tokens TO anon, authenticated, service_role;

-- Jeton initial (long, non devinable). Récupérable / révocable depuis /admin/tgr.
INSERT INTO tgr_supervisor_tokens (token, label)
SELECT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
       'Responsable Touring'
WHERE NOT EXISTS (SELECT 1 FROM tgr_supervisor_tokens);

-- Email destinataire du bilan mensuel (à renseigner depuis /admin/tgr).
INSERT INTO app_settings (key, value) VALUES ('tgr_supervisor_email', '')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
