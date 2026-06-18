-- supabase/migrations/202606181500_source_default_depot.sql
--
-- Olivier 2026-06-18 : parc (dépôt) par défaut par source de mission.
-- Permet, à la mise en parc d'un véhicule, de pré-sélectionner le dépôt
-- configuré pour la source (ex: missions Touring → parc Verviers).
-- default_depot_name = cache du libellé pour affichage sans jointure.

ALTER TABLE public.mission_source_catalog
  ADD COLUMN IF NOT EXISTS default_depot_id   UUID REFERENCES public.depots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_depot_name TEXT;

COMMENT ON COLUMN public.mission_source_catalog.default_depot_id IS
  'Dépôt/parc par défaut pour la mise en parc des missions de cette source. NULL = pas de défaut.';

NOTIFY pgrst, 'reload schema';
