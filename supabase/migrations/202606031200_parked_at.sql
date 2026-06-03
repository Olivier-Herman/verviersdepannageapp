-- src/supabase/migrations/202606031200_parked_at.sql
--
-- Olivier 2026-06-03 : ajoute parked_at sur incoming_missions pour avoir
-- une date d entree parc propre (filtrable dans la recherche /fourriere).
-- Backfill : si status est terminal cote parc, on prend loaded_at ou updated_at.

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS parked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_parked_at
  ON public.incoming_missions (parked_at DESC)
  WHERE parked_at IS NOT NULL;

-- Backfill best-effort : missions actuellement en parc
UPDATE public.incoming_missions
   SET parked_at = COALESCE(loaded_at, updated_at)
 WHERE parked_at IS NULL
   AND status IN ('parked', 'delivering', 'unlocated');

COMMENT ON COLUMN public.incoming_missions.parked_at IS
  'Date entree parc — set quand status devient parked (a maintenir cote app).';

NOTIFY pgrst, 'reload schema';
