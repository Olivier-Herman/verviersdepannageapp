-- Olivier 2026-05-26 : table dedup push pour eviter les bursts (cf incident
-- 10 push "Remorquage AXA" identiques en 30s, mission jamais consolidee en BD).
-- Mecanisme defensif : avant chaque sendPushToRole, INSERT (tag, sent_at) avec
-- ON CONFLICT DO NOTHING. Si insert echoue (conflit) -> tag deja vu < TTL ->
-- skip push silencieusement.

CREATE TABLE IF NOT EXISTS push_dedupe (
  tag        TEXT PRIMARY KEY,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TTL : on conserve max 24h pour eviter que la table grossisse a l infini.
-- Cleanup automatique via index conditionnel + cron leger (ou simple DELETE
-- on insert si on veut zero maintenance).
CREATE INDEX IF NOT EXISTS push_dedupe_sent_at_idx ON push_dedupe (sent_at);

COMMENT ON TABLE push_dedupe IS
  'Anti-spam push: 1 seul push par (tag) toutes les N secondes. Cleanup auto via cron.';

-- Disable RLS (write/lecture serveur uniquement)
ALTER TABLE push_dedupe DISABLE ROW LEVEL SECURITY;
GRANT ALL ON push_dedupe TO service_role;
