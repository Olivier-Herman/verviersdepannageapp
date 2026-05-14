-- ============================================================
-- Archivage automatique des missions facturees
-- ============================================================
-- Stratégie : soft delete via colonne archived_at.
-- - Les missions completed depuis > 7 jours sont marquees archived_at = now()
--   par le cron /api/cron/auto-archive (quotidien).
-- - Les vues "actives" (dispatch list, facturation, etc.) filtrent
--   WHERE archived_at IS NULL → tableaux allegés, perf maximale.
-- - La recherche globale ⌘K ratisse PARTOUT (archived inclus) avec
--   un badge "🗄 Archivée" pour les retrouver facilement.
-- - Une page admin /admin/archives permet de desarchiver si besoin.
--
-- Pour les chaines REM+REL : on attend que TOUTES les missions de la
-- chaine soient completed depuis > 7 jours avant d'archiver (gestion
-- cote cron).

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.incoming_missions.archived_at IS
  'Timestamp d''archivage automatique. Mission marquee archived par le cron auto-archive 7j apres la facturation complete. Les vues actives filtrent par archived_at IS NULL. La recherche globale ratisse tout.';

-- Index partiel : couvre les queries actives qui filtrent par status + date
-- (dispatch list, facturation list, etc.). Postgres ne scanne que les
-- missions actives → perf identique meme avec 100K archives en BDD.
CREATE INDEX IF NOT EXISTS idx_incoming_missions_active
  ON public.incoming_missions(status, received_at DESC)
  WHERE archived_at IS NULL;

-- Index pour le cron qui cherche les candidates a l'archivage
CREATE INDEX IF NOT EXISTS idx_incoming_missions_archive_candidates
  ON public.incoming_missions(invoiced_at)
  WHERE archived_at IS NULL AND status = 'completed' AND invoiced_at IS NOT NULL;

-- Index pour la page /admin/archives (liste paginee des archivees)
CREATE INDEX IF NOT EXISTS idx_incoming_missions_archived
  ON public.incoming_missions(archived_at DESC)
  WHERE archived_at IS NOT NULL;
