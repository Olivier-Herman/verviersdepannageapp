-- ============================================================
-- 202605231400_catalog_display_color_and_group
-- ============================================================
-- Phase 3+4 du chantier [[admin-zero-hardcode]] : ajoute au catalog des
-- sources les attributs UI necessaires pour supprimer le hardcode :
--
--   - display_color : classe Tailwind pour les badges (ex 'bg-blue-600').
--     Utilise par DispatchClient, MissionDetailClient, admin/missions,
--     archives, etc. Replace les SOURCE_LABELS / SOURCE_COLORS hardcodes.
--
--   - group_key : permet de regrouper plusieurs sources sous un meta-choix
--     dans l UI (ex: 'police' regroupe police_accident, police_saisie,
--     police_rodeo, police_avp, police_mg). Aujourd hui cette convention
--     etait hardcodee dans /dispatch/new (POLICE_SUBTYPE_KEYS). Maintenant
--     configurable depuis /admin/sources.
--
-- Olivier 2026-05-23 : "il faut absolument que dans toute l app, il y ait
-- correspondance dans les elements. Je veux une page d'administration
-- claire... Je dois pouvoir faire toutes les modifications necessaires
-- dans l administration sans devoir passer par Claude Code"
-- ============================================================

ALTER TABLE public.mission_source_catalog
  ADD COLUMN IF NOT EXISTS display_color TEXT,
  ADD COLUMN IF NOT EXISTS group_key     TEXT;

COMMENT ON COLUMN public.mission_source_catalog.display_color IS
  'Classe Tailwind pour les badges affiches dans l UI (ex bg-blue-600). NULL = couleur par defaut bg-zinc-600.';

COMMENT ON COLUMN public.mission_source_catalog.group_key IS
  'Regroupement UI : sources avec meme group_key sont presentees sous un meta-choix dans /dispatch/new (ex group_key=police regroupe police_accident, police_saisie, etc.). NULL = source autonome.';

-- Seed des couleurs et groupes connues. Coherence avec les SOURCE_LABELS
-- hardcodes existants dans DispatchClient.tsx, MissionDetailClient.tsx,
-- ArchivesClient.tsx, missions-terminees, etc.
UPDATE public.mission_source_catalog SET display_color = 'bg-blue-600'       WHERE key = 'touring'      AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-emerald-600'    WHERE key = 'kaze'         AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-purple-600'     WHERE key = 'allianz'      AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-yellow-600'     WHERE key = 'vab'          AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-cyan-600'       WHERE key = 'axa'          AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-green-600'      WHERE key = 'ethias'       AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-orange-600'     WHERE key = 'vivium'       AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-fuchsia-600'    WHERE key = 'mondial'      AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-teal-600'       WHERE key = 'ardenne'      AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-indigo-600'     WHERE key = 'aginsurance'  AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-rose-600'       WHERE key = 'eurocross'    AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-violet-600'     WHERE key = 'pv_assistance' AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-blue-900'       WHERE key LIKE 'police_%'  AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-blue-900'       WHERE key = 'sia_couvert'  AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-zinc-700'       WHERE key = 'prive'        AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-amber-700'      WHERE key = 'garage'       AND display_color IS NULL;
UPDATE public.mission_source_catalog SET display_color = 'bg-stone-600'      WHERE key = 'tgr_touring'  AND display_color IS NULL;

-- Seed des regroupements UI. Aujourd hui seul 'police' regroupe les 5
-- sub-types Police (sauf police_snc qui est Siabis NC, source autonome).
UPDATE public.mission_source_catalog
SET group_key = 'police'
WHERE key IN ('police_accident', 'police_saisie', 'police_rodeo', 'police_avp', 'police_mg')
  AND group_key IS NULL;

-- Index pour les requetes par group_key (UI dispatch new)
CREATE INDEX IF NOT EXISTS idx_mission_source_catalog_group_key
  ON public.mission_source_catalog(group_key)
  WHERE group_key IS NOT NULL;
