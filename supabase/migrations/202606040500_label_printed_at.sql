-- src/supabase/migrations/202606040500_label_printed_at.sql
--
-- Olivier 2026-06-04 : track impression etiquette parc pour eviter
-- re-impressions accidentelles (notamment lors de l impression batch en fin
-- de zone du module migration TowSoft).
--
-- Utilise par /api/admin/towsoft-migration/print-zone (only_unprinted=true
-- par defaut) mais peut servir a tout autre endpoint de re-impression batch
-- ulterieurement.

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS label_printed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_label_printed
  ON public.incoming_missions (parc_zone_key, label_printed_at)
  WHERE label_printed_at IS NULL;

COMMENT ON COLUMN public.incoming_missions.label_printed_at IS
  'Timestamp derniere impression etiquette parc reussie. NULL = jamais imprimee. '
  'Reset manuellement si reimpression voulue (queue PC Zebra gere les bourrages).';

NOTIFY pgrst, 'reload schema';
