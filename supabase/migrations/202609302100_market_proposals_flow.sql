-- Propositions de nuit, version 2 (Olivier 30/09/2026 soir) : garde-fou quand le 1er
-- départ répond « Je suis déjà en mission » (estimation de son arrivée, confirmation,
-- « Rappelle-moi dans 15 min », « J'appelle le client » avec 10 min pour répondre),
-- la réserve peut renvoyer la mission au 1er départ, et un journal d'événements
-- alimente la page de statistiques /admin/garde-nuit.
-- Cf src/lib/missions/market-proposals.ts et src/lib/missions/busy-eta.ts.

-- Étape en cours d'une proposition ouverte :
--   asked       : proposition envoyée (appel après 2 min, suite après 4 min)
--   ask_minutes : « Tu en as pour combien de temps ? » (pas de fiche en cours)
--   confirm     : estimation affichée, on attend sa confirmation
--   client_call : il appelle le client pour annoncer son délai (10 min)
--   snoozed     : « Rappelle-moi dans 15 min »
ALTER TABLE public.market_proposals ADD COLUMN IF NOT EXISTS phase         text NOT NULL DEFAULT 'asked';
ALTER TABLE public.market_proposals ADD COLUMN IF NOT EXISTS phase_at      timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.market_proposals ADD COLUMN IF NOT EXISTS snooze_until  timestamptz;
ALTER TABLE public.market_proposals ADD COLUMN IF NOT EXISTS snooze_count  integer NOT NULL DEFAULT 0;
ALTER TABLE public.market_proposals ADD COLUMN IF NOT EXISTS busy_minutes  integer;       -- « j'en ai pour X min » (sans fiche)
ALTER TABLE public.market_proposals ADD COLUMN IF NOT EXISTS eta_min       integer;       -- arrivée estimée sur la nouvelle mission (min)
ALTER TABLE public.market_proposals ADD COLUMN IF NOT EXISTS eta_detail    jsonb;         -- étapes du calcul, lisibles
ALTER TABLE public.market_proposals ADD COLUMN IF NOT EXISTS client_call_at timestamptz;
ALTER TABLE public.market_proposals DROP CONSTRAINT IF EXISTS market_proposals_phase_check;
ALTER TABLE public.market_proposals ADD CONSTRAINT market_proposals_phase_check
  CHECK (phase IN ('asked', 'ask_minutes', 'confirm', 'client_call', 'snoozed'));

-- Journal pour les statistiques (une ligne par étape : proposée, appel, acceptée,
-- déjà en mission, estimation, rappel 15 min, appel client, réserve, renvoi…).
CREATE TABLE IF NOT EXISTS public.market_proposal_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  uuid REFERENCES public.market_proposals(id) ON DELETE CASCADE,
  mission_id   uuid REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  driver_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind         text NOT NULL,
  data         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_proposal_events_created ON public.market_proposal_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_proposal_events_mission ON public.market_proposal_events (mission_id, created_at);

ALTER TABLE public.market_proposal_events DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_proposal_events TO service_role;

notify pgrst, 'reload schema';
