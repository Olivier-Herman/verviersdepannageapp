-- src/supabase/migrations/202606031700_ensure_zones_labo_s.sql
--
-- Olivier 2026-06-03 : LABO et S existaient dans FOURRIERE_ZONES (lib) et
-- dans Odoo mais manquaient dans parc_zones (BDD). prepare-full-inventory
-- echouait sur FK violation pour les 5 vehicules LABO + 1 S a inserer.

INSERT INTO public.parc_zones (key, label, sort_order, depot_id)
SELECT 'LABO', 'LABO', 145, (SELECT id FROM public.depots WHERE name = 'Pepinster' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.parc_zones WHERE key = 'LABO');

INSERT INTO public.parc_zones (key, label, sort_order, depot_id)
SELECT 'S', 'S', 155, (SELECT id FROM public.depots WHERE name = 'Pepinster' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.parc_zones WHERE key = 'S');

NOTIFY pgrst, 'reload schema';
