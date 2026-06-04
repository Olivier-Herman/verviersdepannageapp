-- src/supabase/migrations/202606040100_error_logs.sql
--
-- Olivier 2026-06-03 (audit J-2 W4) : table de logs erreurs serveur pour
-- diagnostiquer en prod sans depender des Vercel logs (qui sont volatiles
-- et n ont pas de filtre).
--
-- Page /admin/logs (superadmin uniquement) affiche cette table avec filtres.

CREATE TABLE IF NOT EXISTS public.error_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level        TEXT NOT NULL DEFAULT 'error',  -- error | warn | info
  route        TEXT,                            -- ex: '/api/towsoft/create'
  message      TEXT NOT NULL,
  metadata     JSONB,
  user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  user_email   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at
  ON public.error_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_route
  ON public.error_logs (route, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_level
  ON public.error_logs (level, created_at DESC);

ALTER TABLE public.error_logs DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.error_logs TO service_role;
GRANT SELECT ON public.error_logs TO authenticated;

COMMENT ON TABLE public.error_logs IS
  'Logs erreurs serveur applicatives (errors metier, integrations down, etc.). '
  'Lu via /admin/logs superadmin. Cron de nettoyage > 30j a ajouter post-prod.';

NOTIFY pgrst, 'reload schema';
