-- src/supabase/migrations/202606050100_towsoft_archive.sql
--
-- Olivier 2026-06-05 : archive complete de TOUTES les missions TowSoft
-- historiques (~47000 missions, range 10000 → 57667+) pour la recherche
-- enrichie. Different de towsoft_migration_source qui ne contient que
-- les 733 vehicules du parc actuel.
--
-- Strategie : iteration sequentielle par num via fetchTowsoftDetail
-- (5 endpoints scrape). Cadence prevue 60 missions / 3 min via cron Vercel.
--
-- Skip : les towsoft_num deja presents dans towsoft_migration_source
-- (pour ne pas dupliquer les 733 deja enrichis).
--
-- Annulees : stockees avec is_cancelled=true (filtre par defaut dans la
-- recherche, toggle pour les voir si besoin).

CREATE TABLE IF NOT EXISTS public.towsoft_archive (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cle d idempotence : n° fiche TowSoft (unique)
  towsoft_num           TEXT UNIQUE NOT NULL,

  -- Detail enrichi (rempli par cron 5 endpoints)
  detail_payload        JSONB,
  detail_fetched_at     TIMESTAMPTZ,
  detail_error          TEXT,

  -- Champs extraits du detail pour search rapide
  plate                 TEXT,
  vin                   TEXT,
  brand                 TEXT,
  model                 TEXT,
  motif                 TEXT,
  client_name           TEXT,
  date_appel            TIMESTAMPTZ,
  appel_status          TEXT,
  is_cancelled          BOOLEAN NOT NULL DEFAULT false,

  -- Workflow enrich
  enrich_attempts       INTEGER NOT NULL DEFAULT 0,
  enrich_error          TEXT,
  next_enrich_retry_at  TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index search par plaque / VIN / client
CREATE INDEX IF NOT EXISTS idx_tarchive_plate       ON public.towsoft_archive (plate);
CREATE INDEX IF NOT EXISTS idx_tarchive_vin         ON public.towsoft_archive (vin);
CREATE INDEX IF NOT EXISTS idx_tarchive_client      ON public.towsoft_archive (client_name);
CREATE INDEX IF NOT EXISTS idx_tarchive_date        ON public.towsoft_archive (date_appel DESC);

-- Index cron : missions a enrichir (pas encore fetch + pas en retry actif)
CREATE INDEX IF NOT EXISTS idx_tarchive_pending_enrich
  ON public.towsoft_archive (next_enrich_retry_at NULLS FIRST)
  WHERE detail_fetched_at IS NULL;

-- Filtre recherche : exclure annulees par defaut
CREATE INDEX IF NOT EXISTS idx_tarchive_active
  ON public.towsoft_archive (is_cancelled, date_appel DESC)
  WHERE is_cancelled = false;

ALTER TABLE public.towsoft_archive DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.towsoft_archive TO service_role;
GRANT SELECT ON public.towsoft_archive TO authenticated;

COMMENT ON TABLE public.towsoft_archive IS
  'Archive complete des missions TowSoft historiques (~47000) pour la '
  'recherche enrichie. Cf module /recherche + panel MissionArchiveSheet. '
  'Skip les towsoft_num deja dans towsoft_migration_source (parc actuel).';

NOTIFY pgrst, 'reload schema';
