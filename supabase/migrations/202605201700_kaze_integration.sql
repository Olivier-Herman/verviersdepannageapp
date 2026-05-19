-- ============================================================
-- 202605201700_kaze_integration
-- ============================================================
-- Integration API Kaze (plateforme IMA Benelux : Ethias, Vivium,
-- P&V Assistance, etc.). Remplace progressivement le parsing mail
-- pour ces sources.
--
-- Composants :
--   1) Source "pv_assistance" dans mission_source_catalog
--      (Ethias et Vivium existent deja)
--   2) Colonne kaze_job_id sur incoming_missions (UUID Kaze pour
--      lier nos missions aux jobs Kaze, dedup et update inversement)
--   3) Table kaze_webhook_events pour audit/replay des notifications
--      recues de Kaze (event_type, payload, traitement)
-- ============================================================

-- 1) Source pv_assistance ----------------------------------------
INSERT INTO public.mission_source_catalog (key, label, sort_order)
VALUES ('pv_assistance', 'P&V Assistance', 45)
ON CONFLICT (key) DO NOTHING;

-- 2) kaze_job_id sur incoming_missions ---------------------------
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS kaze_job_id TEXT;

-- Unique partiel : permet plusieurs NULL (missions hors Kaze) mais
-- empeche les doublons cote Kaze.
CREATE UNIQUE INDEX IF NOT EXISTS uq_incoming_missions_kaze_job_id
  ON public.incoming_missions (kaze_job_id)
  WHERE kaze_job_id IS NOT NULL;

COMMENT ON COLUMN public.incoming_missions.kaze_job_id IS
  'UUID du Job Kaze (IMA Benelux). NULL si la mission ne vient pas de Kaze.';

-- 3) Audit des webhooks Kaze -------------------------------------
CREATE TABLE IF NOT EXISTS public.kaze_webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT,                       -- a remplir au parsing (champ Kaze a decouvrir)
  kaze_job_id       TEXT,                       -- a extraire du payload si present
  payload           JSONB NOT NULL,             -- corps brut recu de Kaze
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,                -- NULL = pas encore traite
  processing_error  TEXT,                       -- message d erreur si traitement echoue
  mission_id        UUID REFERENCES public.incoming_missions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kaze_webhook_events_received_at
  ON public.kaze_webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_kaze_webhook_events_kaze_job_id
  ON public.kaze_webhook_events (kaze_job_id)
  WHERE kaze_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kaze_webhook_events_unprocessed
  ON public.kaze_webhook_events (received_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.kaze_webhook_events DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.kaze_webhook_events TO service_role;

COMMENT ON TABLE public.kaze_webhook_events IS
  'Audit + replay des webhooks recus de Kaze (IMA Benelux). Conserve le payload brut pour pouvoir replay si besoin.';
