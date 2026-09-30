-- Propositions de nuit Momo Market (Olivier 30/09/2026, suite de l'idée de Franck).
-- Une mission libre arrive la nuit : si le 1er départ est libre, elle lui est
-- PROPOSÉE (« J'accepte » / « Je suis déjà en mission ») ; sans réponse après
-- 2 min → appel avec message vocal ; après 2 min de plus → proposée à la réserve
-- (si son toggle est actif), le dispatcher de garde est informé à chaque étape.
-- Une seule proposition ouverte par mission. Cf src/lib/missions/market-proposals.ts.
CREATE TABLE IF NOT EXISTS public.market_proposals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id    uuid NOT NULL REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  driver_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  step          text NOT NULL CHECK (step IN ('night_first', 'reserve')),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'busy', 'timeout', 'cancelled')),
  reason        text,                    -- pourquoi cette étape (ex. « Franck n'a pas répondu »)
  notified_at   timestamptz NOT NULL DEFAULT now(),
  call_at       timestamptz,             -- appel Teams lancé (1er départ seulement)
  call_id       text,                    -- id de l'appel Graph (callback → message vocal)
  call_error    text,                    -- appel impossible (pas de numéro, Teams KO…)
  responded_at  timestamptz,
  closed_reason text,                    -- claimed / assigned / mission_gone / timeout / busy
  closed_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_proposals_open ON public.market_proposals (mission_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_market_proposals_status ON public.market_proposals (status, notified_at);
CREATE INDEX IF NOT EXISTS idx_market_proposals_call ON public.market_proposals (call_id) WHERE call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_proposals_mission ON public.market_proposals (mission_id, created_at);

ALTER TABLE public.market_proposals DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_proposals TO service_role;

notify pgrst, 'reload schema';
