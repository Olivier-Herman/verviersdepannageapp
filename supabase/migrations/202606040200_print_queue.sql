-- src/supabase/migrations/202606040200_print_queue.sql
--
-- Olivier 2026-06-03 (audit J-2 W1) : queue impression Zebra cote VD Soft
-- pour resilience aux pannes/deconnexions du PC zebra-serveur.
--
-- Flow :
--   1. Au moment d imprimer, INSERT dans print_queue (status='pending')
--   2. Tentative immediate d impression via printZPLRaw
--   3. Si succes : UPDATE status='printed' + printed_at
--   4. Si echec : reste 'pending', attempts++, next_retry_at = +2min
--   5. Cron toutes les 2 min : reprend les pending et retry
--
-- Quand le PC revient online, le cron vide automatiquement la queue.

CREATE TABLE IF NOT EXISTS public.print_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      UUID REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  zpl             TEXT NOT NULL,
  context         TEXT,                   -- 'parc_label', 'rel_label', etc.
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | printed | failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  printed_at      TIMESTAMPTZ,
  next_retry_at   TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_queue_pending
  ON public.print_queue (next_retry_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_print_queue_mission
  ON public.print_queue (mission_id, created_at DESC);

ALTER TABLE public.print_queue DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.print_queue TO service_role;
GRANT SELECT ON public.print_queue TO authenticated;

COMMENT ON TABLE public.print_queue IS
  'Queue impression Zebra resiliente. Le cron /api/cron/print-queue tourne '
  'toutes les 2 min et retiente les pending. Permet impression differee si '
  'PC zebra-serveur offline / imprimante en bourrage.';

NOTIFY pgrst, 'reload schema';
