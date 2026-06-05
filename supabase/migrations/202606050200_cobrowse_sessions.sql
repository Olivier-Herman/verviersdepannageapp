-- src/supabase/migrations/202606050200_cobrowse_sessions.sql
--
-- Olivier 2026-06-05 : co-browsing system pour depanner les users en
-- production. User clique "Demander de l aide" -> session pending +
-- push notif a tous les superadmin -> un admin "Rejoint" -> il voit en
-- temps reel la navigation + clics du user via Supabase Realtime channel
-- 'cobrowse:{session_id}'.
--
-- Synchronisation = auto-redirect a la meme URL + curseur fantome sur clic
-- (pas pixel-perfect DOM mirror, mais permet de guider le user en direct).

CREATE TABLE IF NOT EXISTS public.cobrowse_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_message  TEXT,                                -- optionnel : "j ai un bug sur X"
  user_url      TEXT,                                -- URL au moment du clic "demander aide"
  user_agent    TEXT,                                -- info device/browser

  admin_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  admin_joined_at TIMESTAMPTZ,

  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'ended', 'cancelled')),

  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  ended_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ended_reason  TEXT,                                -- 'user_quit' / 'admin_quit' / 'timeout'

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cobrowse_pending
  ON public.cobrowse_sessions (started_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_cobrowse_user_active
  ON public.cobrowse_sessions (user_id, status)
  WHERE status IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS idx_cobrowse_admin_active
  ON public.cobrowse_sessions (admin_id, status)
  WHERE status = 'active';

ALTER TABLE public.cobrowse_sessions DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.cobrowse_sessions TO service_role;
GRANT SELECT ON public.cobrowse_sessions TO authenticated;

COMMENT ON TABLE public.cobrowse_sessions IS
  'Sessions de co-browsing user <-> admin pour debug live en prod. '
  'Realtime channel = cobrowse:{session_id} (events : nav, click, scroll, input).';

NOTIFY pgrst, 'reload schema';
