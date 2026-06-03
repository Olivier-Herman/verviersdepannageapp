-- src/supabase/migrations/202606031800_towsoft_enriched_at.sql
--
-- Olivier 2026-06-03 : on stockait l info "enrichi via TowSoft" en taggant
-- source = 'legacy_towsoft_enriched', mais ca empechait d avoir la VRAIE
-- source (police_mg, police_accident, etc.) pour le calcul du tarif. On
-- separe : source garde la vraie source, towsoft_enriched_at trace l enrichissement.

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS towsoft_enriched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_towsoft_enriched
  ON public.incoming_missions (towsoft_enriched_at)
  WHERE towsoft_enriched_at IS NOT NULL;

COMMENT ON COLUMN public.incoming_missions.towsoft_enriched_at IS
  'Timestamp du dernier scraping TowSoft reussi. NULL = pas encore enrichi.';

-- Migrer les missions deja taggees legacy_towsoft_enriched (peu probable
-- mais propre) : on remet source a NULL pour qu un prochain enrichissement
-- la reassigne correctement basee sur le motif TowSoft.
UPDATE public.incoming_missions
   SET towsoft_enriched_at = updated_at,
       source              = 'legacy_odoo'
 WHERE source = 'legacy_towsoft_enriched';

NOTIFY pgrst, 'reload schema';
