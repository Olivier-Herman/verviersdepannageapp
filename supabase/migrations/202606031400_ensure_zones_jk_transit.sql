-- src/supabase/migrations/202606031400_ensure_zones_jk_transit.sql
--
-- Olivier 2026-06-03 : s assure que les zones J, K et Transit existent dans
-- parc_zones et sont rattachees a Pepinster (parc par defaut). Les state_id
-- Odoo sont J=29, K=30, Transit=15 (cf src/lib/fourriere.ts).

-- Insert si absent
INSERT INTO public.parc_zones (key, label, sort_order)
SELECT v.key, v.label, v.sort_order
FROM (VALUES
  ('J',       'J',       105),
  ('K',       'K',       108),
  ('Transit', 'Transit', 150)
) AS v(key, label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.parc_zones z WHERE z.key = v.key
);

-- Rattacher a Pepinster si pas deja rattache
UPDATE public.parc_zones
   SET depot_id = (SELECT id FROM public.depots WHERE name = 'Pepinster' LIMIT 1)
 WHERE key IN ('J', 'K', 'Transit')
   AND depot_id IS NULL;

NOTIFY pgrst, 'reload schema';
