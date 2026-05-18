-- supabase/migrations/202605181700_assistant.sql
--
-- Assistant IA superadmin : conversations persistantes + mémoire long-terme
-- + log des tool calls pour audit.

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'Nouvelle conversation',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived    BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_assistant_conv_user ON assistant_conversations(user_id, updated_at DESC);

ALTER TABLE assistant_conversations DISABLE ROW LEVEL SECURITY;
GRANT ALL ON assistant_conversations TO authenticated, service_role, anon;

CREATE TABLE IF NOT EXISTS assistant_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         JSONB NOT NULL,         -- text msg, ou tool_use blocks, ou tool_result
  tool_call_id    TEXT,                   -- pour role='tool' : id du tool_use
  tool_name       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_msg_conv ON assistant_messages(conversation_id, created_at);

ALTER TABLE assistant_messages DISABLE ROW LEVEL SECURITY;
GRANT ALL ON assistant_messages TO authenticated, service_role, anon;

-- Mémoire long-terme par user (préférences, faits persistants entre conversations)
CREATE TABLE IF NOT EXISTS assistant_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,            -- ex: 'preferences', 'project_context'
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, key)
);

ALTER TABLE assistant_memory DISABLE ROW LEVEL SECURITY;
GRANT ALL ON assistant_memory TO authenticated, service_role, anon;

-- Log des appels d'outils (audit + debugging)
CREATE TABLE IF NOT EXISTS assistant_tool_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  tool_name       TEXT NOT NULL,
  args            JSONB,
  result          JSONB,
  success         BOOLEAN NOT NULL,
  error           TEXT,
  duration_ms     INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_tool_calls_conv ON assistant_tool_calls(conversation_id, created_at DESC);

ALTER TABLE assistant_tool_calls DISABLE ROW LEVEL SECURITY;
GRANT ALL ON assistant_tool_calls TO authenticated, service_role, anon;
