-- ============================================================
-- 202605171500_auth_debug_log (TEMPORAIRE - a supprimer apres debug)
-- ============================================================
-- Table pour tracer les events du signIn callback NextAuth.
-- Sert UNIQUEMENT a diagnostiquer pourquoi le linking Apple ne cree pas
-- de row dans user_auth_providers. A supprimer une fois le bug resolu.

CREATE TABLE IF NOT EXISTS public.auth_debug_log (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ DEFAULT NOW(),
  event     TEXT NOT NULL,
  payload   JSONB
);

ALTER TABLE public.auth_debug_log DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.auth_debug_log TO service_role;
GRANT USAGE ON SEQUENCE public.auth_debug_log_id_seq TO service_role;
