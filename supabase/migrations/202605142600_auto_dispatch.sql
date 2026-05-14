-- ============================================================
-- Auto-dispatch — logs de tentatives + module permission
-- ============================================================
-- Cf project_auto_dispatch_scenario.md pour le flow detaille.

-- Table de tracability des tentatives auto-dispatch.
-- Chaque mission auto-dispatchee genere N rows (1 par chauffeur tente).
-- Le cron /api/cron/auto-dispatch-tick lit ces rows et fait evoluer
-- le flow (push → call → next driver → escalade).
CREATE TABLE IF NOT EXISTS public.dispatch_attempts_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id            uuid NOT NULL REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  driver_id             uuid REFERENCES public.users(id) ON DELETE SET NULL,
  attempt_order         int  NOT NULL,                -- 1=C1, 2=C2, ...
  status                text NOT NULL DEFAULT 'pending',
    -- 'pending', 'push_sent', 'call_1_sent', 'call_2_sent',
    -- 'accepted', 'refused', 'unavailable', 'timeout', 'skipped'
  push_sent_at          timestamptz,
  call_1_at             timestamptz,
  call_1_picked_up      boolean,
  call_2_at             timestamptz,
  call_2_picked_up      boolean,
  responded_at          timestamptz,
  response_min          int,                          -- "Dispo dans X min" pour en-mission
  theoretical_min       int,                          -- notre baseline ETA pour comparer
  not_available_reason  text,                         -- "intervention police", etc.
  triggered_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  escalated             boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_attempts_mission_order_idx
  ON public.dispatch_attempts_log (mission_id, attempt_order);

CREATE INDEX IF NOT EXISTS dispatch_attempts_pending_idx
  ON public.dispatch_attempts_log (status, updated_at)
  WHERE status IN ('pending', 'push_sent', 'call_1_sent', 'call_2_sent');

ALTER TABLE public.dispatch_attempts_log DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dispatch_attempts_log TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_attempts_log TO authenticated;

-- Module auto_dispatch : permission pour declencher le bouton
INSERT INTO public.modules (id, label, description, active, sort_order)
VALUES ('auto_dispatch', 'Auto-dispatch', 'Permet d''activer l''auto-dispatch sur une mission entrante', true, 200)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.dispatch_attempts_log IS
  'Log des tentatives auto-dispatch (1 row par chauffeur tente). Lu par le cron pour evoluer le flow (push → call → next).';
