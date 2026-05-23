-- ============================================================
-- 202605231600_catalog_display_color_hex
-- ============================================================
-- Ajoute display_color_hex au catalog : couleur en format hex (#3b82f6)
-- utilisee par les composants qui ne supportent pas les classes Tailwind
-- (ex: graphes Recharts dans /stats qui demande fill='#xxxxxx').
--
-- Complement de display_color (classe Tailwind) ajoute dans la migration
-- 202605231400. La hex est seede en cohherence avec la Tailwind pour
-- garder une seule couleur visuelle par source.
-- ============================================================

ALTER TABLE public.mission_source_catalog
  ADD COLUMN IF NOT EXISTS display_color_hex TEXT;

COMMENT ON COLUMN public.mission_source_catalog.display_color_hex IS
  'Couleur en hex (#3b82f6) pour les composants non-Tailwind (graphes Recharts, etc.). Coherent avec display_color (classe Tailwind).';

-- Seed des hex en coherence avec les Tailwind classes deja seedees
UPDATE public.mission_source_catalog SET display_color_hex = '#2563eb' WHERE key = 'touring'      AND display_color_hex IS NULL; -- bg-blue-600
UPDATE public.mission_source_catalog SET display_color_hex = '#059669' WHERE key = 'kaze'         AND display_color_hex IS NULL; -- bg-emerald-600
UPDATE public.mission_source_catalog SET display_color_hex = '#9333ea' WHERE key = 'allianz'      AND display_color_hex IS NULL; -- bg-purple-600
UPDATE public.mission_source_catalog SET display_color_hex = '#ca8a04' WHERE key = 'vab'          AND display_color_hex IS NULL; -- bg-yellow-600
UPDATE public.mission_source_catalog SET display_color_hex = '#0891b2' WHERE key = 'axa'          AND display_color_hex IS NULL; -- bg-cyan-600
UPDATE public.mission_source_catalog SET display_color_hex = '#16a34a' WHERE key = 'ethias'       AND display_color_hex IS NULL; -- bg-green-600
UPDATE public.mission_source_catalog SET display_color_hex = '#ea580c' WHERE key = 'vivium'       AND display_color_hex IS NULL; -- bg-orange-600
UPDATE public.mission_source_catalog SET display_color_hex = '#c026d3' WHERE key = 'mondial'      AND display_color_hex IS NULL; -- bg-fuchsia-600
UPDATE public.mission_source_catalog SET display_color_hex = '#0d9488' WHERE key = 'ardenne'      AND display_color_hex IS NULL; -- bg-teal-600
UPDATE public.mission_source_catalog SET display_color_hex = '#4f46e5' WHERE key = 'aginsurance'  AND display_color_hex IS NULL; -- bg-indigo-600
UPDATE public.mission_source_catalog SET display_color_hex = '#e11d48' WHERE key = 'eurocross'    AND display_color_hex IS NULL; -- bg-rose-600
UPDATE public.mission_source_catalog SET display_color_hex = '#7c3aed' WHERE key = 'pv_assistance' AND display_color_hex IS NULL; -- bg-violet-600
UPDATE public.mission_source_catalog SET display_color_hex = '#1e3a8a' WHERE key LIKE 'police_%'  AND display_color_hex IS NULL; -- bg-blue-900
UPDATE public.mission_source_catalog SET display_color_hex = '#1e3a8a' WHERE key = 'sia_couvert'  AND display_color_hex IS NULL; -- bg-blue-900
UPDATE public.mission_source_catalog SET display_color_hex = '#3f3f46' WHERE key = 'prive'        AND display_color_hex IS NULL; -- bg-zinc-700
UPDATE public.mission_source_catalog SET display_color_hex = '#b45309' WHERE key = 'garage'       AND display_color_hex IS NULL; -- bg-amber-700
UPDATE public.mission_source_catalog SET display_color_hex = '#57534e' WHERE key = 'tgr_touring'  AND display_color_hex IS NULL; -- bg-stone-600
