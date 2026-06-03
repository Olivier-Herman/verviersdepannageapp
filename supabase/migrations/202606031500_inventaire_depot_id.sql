-- src/supabase/migrations/202606031500_inventaire_depot_id.sql
--
-- Olivier 2026-06-03 : branche depot_id sur les sessions d inventaire.
-- Une session = un parc + une zone du parc. Le selecteur de zone sera
-- filtre cote UI sur les zones du parc choisi.

ALTER TABLE public.inventaire_sessions
  ADD COLUMN IF NOT EXISTS depot_id UUID REFERENCES public.depots(id);

CREATE INDEX IF NOT EXISTS idx_inventaire_sessions_depot
  ON public.inventaire_sessions (depot_id);

COMMENT ON COLUMN public.inventaire_sessions.depot_id IS
  'Parc/depot sur lequel porte la session d inventaire. NULL = mode legacy global.';

-- Backfill : sessions existantes -> depot par defaut (Pepinster)
UPDATE public.inventaire_sessions
   SET depot_id = (SELECT id FROM public.depots WHERE name = 'Pepinster' LIMIT 1)
 WHERE depot_id IS NULL;

NOTIFY pgrst, 'reload schema';
