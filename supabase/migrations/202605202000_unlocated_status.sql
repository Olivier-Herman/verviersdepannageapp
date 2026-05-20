-- ============================================================
-- 202605202000_unlocated_status
-- ============================================================
-- Ajoute le statut "unlocated" pour les vehicules attendus dans une zone
-- mais non scannes lors de l inventaire de cette zone.
--
-- Workflow :
--   1. Le gestionnaire scanne la zone A → cloture la zone via /finish-zone
--   2. Les vehicules attendus en A mais non scannes passent en
--      status='unlocated' (parc_zone_key garde A pour tracabilite, mais
--      row/slot deviennent null → ils sortent visuellement de la rangee).
--   3. Plus tard, si le vehicule est scanne dans une autre zone via
--      /api/inventaire/place-scan, son status revient a 'parked' avec
--      la nouvelle position. La transition est automatique.
--
-- Colonnes ajoutees :
--   - unlocated_at   : timestamp du passage en unlocated (pour rapport)
--   - unlocated_zone : zone d origine ou on s attendait a le trouver
-- ============================================================

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS unlocated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unlocated_zone TEXT;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_unlocated_at
  ON public.incoming_missions (unlocated_at DESC)
  WHERE unlocated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_unlocated_zone
  ON public.incoming_missions (unlocated_zone)
  WHERE unlocated_zone IS NOT NULL;

COMMENT ON COLUMN public.incoming_missions.unlocated_at IS
  'Timestamp du passage en status=unlocated (lors d un finish-zone d inventaire). NULL si jamais perdu.';
COMMENT ON COLUMN public.incoming_missions.unlocated_zone IS
  'Zone du parc dans laquelle on s attendait a trouver le vehicule au moment de la perte.';
