-- src/supabase/migrations/202606060100_parc_zones_migration_done.sql
--
-- Olivier 2026-06-06 : marque "zone terminee" pour le workflow migration
-- fourriere zone-par-zone. Permet d afficher la progression visuelle dans
-- /fourriere/migration (X/Y zones migrees) et de tracer qui a valide quand.
--
-- Une fois TOUTES les zones marquees, l inventaire VD Soft est officiel
-- (cf accord avec TowSoft CA 2026-06-05 : on garde les vehicules en parc
-- comme source de verite, abandon du rapatriement des 50k historiques).

ALTER TABLE public.parc_zones
  ADD COLUMN IF NOT EXISTS migration_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS migration_completed_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_parc_zones_migration_done
  ON public.parc_zones (migration_completed_at)
  WHERE migration_completed_at IS NOT NULL;

COMMENT ON COLUMN public.parc_zones.migration_completed_at IS
  'Timestamp ou la zone a ete declaree completement scannee dans /fourriere/migration. NULL = pas encore migree.';

NOTIFY pgrst, 'reload schema';
