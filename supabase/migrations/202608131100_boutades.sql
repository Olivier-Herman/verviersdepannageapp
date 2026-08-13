-- Historique des boutades (vannes humoristiques affichées au chauffeur à
-- l'acceptation). Stocké À PART, PAS dans mission_logs → n'apparaît plus sur la
-- fiche ; consultable seulement via la page superadmin. Olivier 2026-08-13.

CREATE TABLE IF NOT EXISTS boutades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  uuid,
  driver_id   uuid,
  driver_name text,
  text        text NOT NULL,
  via         text,          -- 'ia' | 'repli' | 'sujet-sérieux'
  vehicle     text,
  city        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boutades_created_at ON boutades (created_at DESC);

-- Accès API service-role (cf convention : DISABLE RLS + GRANT sinon les API échouent).
ALTER TABLE boutades DISABLE ROW LEVEL SECURITY;
GRANT ALL ON boutades TO service_role, anon, authenticated;
