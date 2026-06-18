-- supabase/migrations/202606181700_source_default_zone.sql
--
-- Olivier 2026-06-18 : zone de parc par défaut par source (complète le dépôt
-- par défaut ajouté en 202606181500). Permet de pré-sélectionner le dépôt ET
-- la zone à la mise en parc (ex: missions Touring → Verviers, zone K).

ALTER TABLE public.mission_source_catalog
  ADD COLUMN IF NOT EXISTS default_parc_zone_key TEXT REFERENCES public.parc_zones(key) ON DELETE SET NULL;

COMMENT ON COLUMN public.mission_source_catalog.default_parc_zone_key IS
  'Zone de parc par défaut (clé parc_zones) pour la mise en parc des missions de cette source. NULL = pas de défaut.';

NOTIFY pgrst, 'reload schema';
