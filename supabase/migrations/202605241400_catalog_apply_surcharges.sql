-- ============================================================
-- 202605241400_catalog_apply_surcharges
-- ============================================================
-- Olivier 2026-05-24 : police_mg, police_rodeo, police_avp n'ont AUCUNE
-- majoration horaire (precise par Olivier). On ne veut pas les afficher
-- dans /admin/surcharges et on veut empecher resolveClientKey de faire
-- fallback vers 'snc' pour ces sources.
--
-- Solution : ajout d'un flag apply_surcharges sur mission_source_catalog
-- (source unique = catalog). Si false :
--   - la source ne s'affiche jamais dans /admin/surcharges
--   - resolveClientKey retourne null (pas de fallback snc)
--   - getApplicableSurcharges retourne []
-- ============================================================

ALTER TABLE public.mission_source_catalog
  ADD COLUMN IF NOT EXISTS apply_surcharges BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.mission_source_catalog.apply_surcharges IS
  'Si false : aucune majoration horaire ne s applique a cette source (pas meme le fallback snc). Utilise pour Mal Garee, Rodeo, AVP qui sont des forfaits fixes.';

-- Marquer les sources sans majoration
UPDATE public.mission_source_catalog
SET apply_surcharges = false
WHERE key IN ('police_mg', 'police_rodeo', 'police_avp');

-- Supprimer les cles vides creees inutilement dans surcharge_clients
-- par la migration 202605241300 (avant qu on ait ce flag)
DELETE FROM public.surcharge_clients
WHERE key IN ('police_mg', 'police_rodeo', 'police_avp')
  AND NOT EXISTS (
    SELECT 1 FROM public.surcharge_schedules WHERE client_key = surcharge_clients.key
  );
