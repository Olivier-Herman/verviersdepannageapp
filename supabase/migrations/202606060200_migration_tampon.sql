-- src/supabase/migrations/202606060200_migration_tampon.sql
--
-- Olivier 2026-06-06 : tracking migration fourriere + tampon Transit.
-- Permet :
--   - Identifier les missions scannees dans la session de migration en cours
--     (vs anciennes en zone X par heritage)
--   - Flagguer les missions transferees automatiquement vers Transit comme
--     "pas scannees pendant la migration de zone X" (= file d attente humaine)
--   - Tracer la raison du pending (search_verviers / sortie_avant_migration / fantome / etc.)
--
-- Workflow :
--   1. Scan migration -> set migration_scanned_at + migration_scanned_zone
--   2. Terminer zone X -> les missions parc_zone_key=X status=parked
--      sans migration_scanned_at (OU < session start) sont transferees
--      en Transit avec migration_pending=true
--   3. UI cleanup Transit traite chaque mission pending
--      -> action humaine met migration_pending=false ou change status

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS migration_scanned_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS migration_scanned_zone    TEXT,
  ADD COLUMN IF NOT EXISTS migration_pending         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS migration_pending_reason  TEXT;

-- Index pour la UI cleanup Transit (rapide)
CREATE INDEX IF NOT EXISTS idx_incoming_missions_migration_pending
  ON public.incoming_missions (migration_pending)
  WHERE migration_pending = true;

-- Index pour le check "missions non scannees lors du terminer-zone"
CREATE INDEX IF NOT EXISTS idx_incoming_missions_migration_scanned
  ON public.incoming_missions (parc_zone_key, status, migration_scanned_at);

COMMENT ON COLUMN public.incoming_missions.migration_scanned_at IS
  'Timestamp du dernier scan migration (set par /api/admin/towsoft-migration/scan). Utilise pour identifier les missions non scannees lors du Terminer zone X.';

COMMENT ON COLUMN public.incoming_missions.migration_pending IS
  'true = mission transferee automatiquement vers Transit lors du Terminer zone X (file d attente humaine). Action requise via UI Nettoyage Transit.';

COMMENT ON COLUMN public.incoming_missions.migration_pending_reason IS
  'Raison du pending : not_scanned_zone_X / search_verviers / etc. Aide a la decision humaine dans UI Cleanup.';

NOTIFY pgrst, 'reload schema';
