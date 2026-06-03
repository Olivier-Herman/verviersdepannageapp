-- src/supabase/migrations/202606031100_parc_depot_link.sql
--
-- Olivier 2026-06-03 : un dépôt = un parc fourrière (5 sites : Pepinster,
-- Verviers, Tiège, Francorchamps, Aywaille). On relie parc_zones à depots
-- via depot_id et on introduit is_default_parc pour distinguer le parc
-- principal (Verviers) du dépôt de départ chauffeur par défaut (Pepinster).
--
-- - is_default (existant) = dépôt de départ chauffeur par défaut → Pepinster
-- - is_default_parc (nouveau) = parc fourrière affiché par défaut → Verviers

-- ────────────────────────────────────────────────────────────────────
-- 1. Colonne is_default_parc sur depots
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.depots
  ADD COLUMN IF NOT EXISTS is_default_parc BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.depots.is_default_parc IS
  'Parc fourrière affiché par défaut dans /fourriere. Un seul à true conseillé.';

-- ────────────────────────────────────────────────────────────────────
-- 2. Créer les 5 dépôts s'ils n'existent pas (idempotent)
-- ────────────────────────────────────────────────────────────────────
INSERT INTO public.depots (name, active, sort_order)
SELECT v.name, true, v.sort_order
FROM (VALUES
  ('Pepinster',     10),
  ('Verviers',      20),
  ('Tiège',         30),
  ('Francorchamps', 40),
  ('Aywaille',      50)
) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.depots d WHERE d.name = v.name
);

-- ────────────────────────────────────────────────────────────────────
-- 3. Marquer Verviers comme parc par défaut (si aucun ne l'est)
-- ────────────────────────────────────────────────────────────────────
UPDATE public.depots
   SET is_default_parc = true
 WHERE name = 'Verviers'
   AND NOT EXISTS (SELECT 1 FROM public.depots WHERE is_default_parc = true);

-- ────────────────────────────────────────────────────────────────────
-- 4. Colonne depot_id sur parc_zones (rattachement zone → parc)
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.parc_zones
  ADD COLUMN IF NOT EXISTS depot_id UUID REFERENCES public.depots(id);

CREATE INDEX IF NOT EXISTS idx_parc_zones_depot_id
  ON public.parc_zones (depot_id);

COMMENT ON COLUMN public.parc_zones.depot_id IS
  'Parc/dépôt fourrière auquel appartient cette zone (référence depots.id).';

-- ────────────────────────────────────────────────────────────────────
-- 5. Backfill : toutes les zones existantes rattachées à Verviers
-- ────────────────────────────────────────────────────────────────────
UPDATE public.parc_zones
   SET depot_id = (SELECT id FROM public.depots WHERE name = 'Verviers' LIMIT 1)
 WHERE depot_id IS NULL;

-- ────────────────────────────────────────────────────────────────────
-- 6. Reload PostgREST
-- ────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
