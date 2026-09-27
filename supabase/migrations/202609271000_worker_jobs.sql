-- ============================================================
-- 202609271000_worker_jobs
-- ============================================================
-- File de travaux pour le WORKER PERSISTANT (VPS Hostinger). Olivier 27/09/2026.
--
-- Pourquoi : les clôtures VAB pilotent un Chromium. Sur Vercel, elles tournent
-- dans une fonction bornée (60-300 s) avec un Chromium serverless ; le 27/09 le
-- filet a échoué 130 fois sur la BMW 1LRN341 et la clôture a dû partir du PC
-- de dev. Rien ne doit dépendre d'un PC : le VPS (déjà allumé 24/7 pour n8n)
-- porte un worker Node avec un vrai Chrome et sans limite de temps.
--
-- Schéma : Vercel reste maître. Le cron lit la liste ouverte chez VAB, décide
-- QUOI clôturer, et pose une demande ici. Le worker prend la demande, exécute
-- le MÊME code de clôture, écrit le résultat. Si le worker ne bat plus (cf
-- app_settings.worker_vps_heartbeat), le cron reprend la clôture lui-même,
-- comme avant : pas de régression possible, seulement un mieux quand le VPS
-- est là.
--
-- Une seule demande vivante par action (dedupe_key) : le cron repasse tous
-- les quarts d'heure et ne doit pas empiler la même clôture.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.worker_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,                       -- 'vab_close' (d'autres suivront : axa_relogin, comex…)
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  dedupe_key   text,                                -- ex. 'vab_close:56458903' — une seule demande vivante
  mission_id   uuid REFERENCES public.incoming_missions(id) ON DELETE SET NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- arguments de l'exécution (missionId, externalId…)
  result       jsonb,                               -- ce que le worker a constaté (soldé ? durée ?)
  error        text,
  attempts     int  NOT NULL DEFAULT 0,
  run_after    timestamptz NOT NULL DEFAULT now(),
  locked_at    timestamptz,                         -- pris par le worker à cette heure
  locked_by    text,                                -- nom du worker (hôte)
  finished_at  timestamptz,
  created_by   text,                                -- 'cron:vab-close-retry', 'admin', …
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_jobs_queue
  ON public.worker_jobs (status, kind, run_after);

-- Une seule demande vivante (en file ou en cours) par clé.
CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_jobs_live_dedupe
  ON public.worker_jobs (dedupe_key)
  WHERE status IN ('queued', 'running') AND dedupe_key IS NOT NULL;

-- Prise atomique d'une demande : le worker appelle cette fonction, jamais
-- UPDATE à la main. SKIP LOCKED = deux workers ne prendraient jamais la même.
CREATE OR REPLACE FUNCTION public.worker_claim_job(p_kinds text[], p_worker text)
RETURNS SETOF public.worker_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  j public.worker_jobs;
BEGIN
  SELECT * INTO j
    FROM public.worker_jobs
   WHERE status = 'queued'
     AND kind = ANY (p_kinds)
     AND run_after <= now()
   ORDER BY created_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.worker_jobs
     SET status = 'running', locked_at = now(), locked_by = p_worker,
         attempts = attempts + 1, updated_at = now()
   WHERE id = j.id
   RETURNING * INTO j;
  RETURN NEXT j;
END;
$$;

-- Comme toutes les tables servies par les API (service_role) : pas de RLS,
-- sinon INSERT/RPC échouent en silence.
ALTER TABLE public.worker_jobs DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.worker_jobs TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_claim_job(text[], text) TO service_role;

-- Battement de cœur du worker (JSON texte, comme les traces des crons) :
-- { at, host, version, busy }. Absent ou vieux de plus de 2 min = worker mort.
INSERT INTO app_settings (key, value, updated_at)
VALUES ('worker_vps_heartbeat', '{}', now())
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
