-- src/supabase/migrations/202606031300_zones_to_pepinster.sql
--
-- Olivier 2026-06-03 : correction du backfill precedent. Les 15 zones existantes
-- (A, B, B*, C, D, E, F, G, H, I, J, K, L, LABO, BOX) sont a Pepinster, pas a
-- Verviers. Pepinster devient aussi le parc par defaut.

-- Reassigner les zones de Verviers (backfill par defaut) vers Pepinster
UPDATE public.parc_zones
   SET depot_id = (SELECT id FROM public.depots WHERE name = 'Pepinster' LIMIT 1)
 WHERE depot_id = (SELECT id FROM public.depots WHERE name = 'Verviers' LIMIT 1);

-- Parc par defaut = Pepinster
UPDATE public.depots SET is_default_parc = false;
UPDATE public.depots SET is_default_parc = true WHERE name = 'Pepinster';

NOTIFY pgrst, 'reload schema';
