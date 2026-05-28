-- Olivier 2026-05-28 : table evaluation_sessions pour pister quand un user
-- envoie son rapport d evaluation et programmer la purge automatique des
-- donnees de test (missions avec plaque TEST) 6h apres l envoi du rapport.
--
-- Cron horaire /api/cron/cleanup-test-data lit cette table.

CREATE TABLE IF NOT EXISTS public.evaluation_sessions (
  user_id          UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  report_sent_at   TIMESTAMPTZ,                       -- moment du dernier envoi
  purged_at        TIMESTAMPTZ,                       -- moment du nettoyage (NULL = pas encore purge)
  purge_summary    JSONB,                             -- { mission_ids: [...], count: N }
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_sessions_purge
  ON public.evaluation_sessions(report_sent_at)
  WHERE purged_at IS NULL;

ALTER TABLE public.evaluation_sessions DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.evaluation_sessions TO service_role;

COMMENT ON TABLE public.evaluation_sessions IS
  'Suivi des sessions d evaluation pour purge auto des missions test 6h apres envoi du rapport. Olivier 2026-05-28.';

NOTIFY pgrst, 'reload schema';
