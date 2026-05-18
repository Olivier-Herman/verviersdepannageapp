-- supabase/migrations/202605181800_inventaire_sessions.sql
--
-- Persiste les sessions du mode inventaire fourriere en DB pour permettre la
-- synchronisation cross-device (scan depuis l'iPhone, telechargement Excel
-- depuis le Mac, etc.).
--
-- Une session = un user + un mois (tag MMYYYY) + une zone cible. Tant que
-- completed_at est NULL, la session est "active" et peut etre reprise.

CREATE TABLE IF NOT EXISTS inventaire_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_name        TEXT NOT NULL,            -- MMYYYY (ex: '052026')
  zone_state_id   INTEGER,
  zone_code       TEXT,
  zone_label      TEXT,
  zone_full_name  TEXT,
  auto_print      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventaire_sessions_user_active
  ON inventaire_sessions(user_id, completed_at) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inventaire_sessions_user
  ON inventaire_sessions(user_id, updated_at DESC);

ALTER TABLE inventaire_sessions DISABLE ROW LEVEL SECURITY;
GRANT ALL ON inventaire_sessions TO authenticated, service_role, anon;

CREATE TABLE IF NOT EXISTS inventaire_session_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES inventaire_sessions(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,             -- 'ok' / 'error'
  item_type     TEXT,                      -- 'reprint' / 'created' / 'updated' / 'error'
  label         TEXT,
  sublabel      TEXT,
  msg           TEXT,
  zone          TEXT,
  printed       BOOLEAN,
  ticket_id     INTEGER,
  mission_num   TEXT,
  ref_dossier   TEXT,
  date_mission  TEXT,
  marque        TEXT,
  modele        TEXT,
  plaque        TEXT,
  vin           TEXT,
  motif         TEXT,
  parc          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventaire_session_items_session
  ON inventaire_session_items(session_id, created_at);

ALTER TABLE inventaire_session_items DISABLE ROW LEVEL SECURITY;
GRANT ALL ON inventaire_session_items TO authenticated, service_role, anon;
