-- ============================================================
-- 202605192000_parc_slot_groups
-- ============================================================
-- Permet de fusionner 2-4 slots adjacents en un emplacement
-- logique unique. Cas d usage : long vehicule (camion, semi),
-- vehicule large prenant 2 places, configuration 2x2.
--
-- Le PREMIER slot selectionne (selection_order=1) est le PRIMARY :
-- il garde son label (ex: H4-4 reste H4-4 meme si on lie H4-3).
-- Les missions placees sur n importe quel slot du groupe sont
-- routees vers le primary cote API.
--
-- Mutuellement exclusif avec parc_blocked_slots : un slot ne peut
-- pas etre a la fois bloque ET fusionne. La contrainte UNIQUE sur
-- (zone_key, row_number, slot_index) garantit qu un slot ne peut
-- etre que dans UN seul groupe.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.parc_slot_groups (
  id              BIGSERIAL PRIMARY KEY,
  group_uuid      UUID NOT NULL DEFAULT gen_random_uuid(),
  zone_key        TEXT NOT NULL REFERENCES public.parc_zones(key) ON DELETE CASCADE,
  row_number      INTEGER NOT NULL CHECK (row_number > 0),
  slot_index      INTEGER NOT NULL CHECK (slot_index > 0),
  selection_order SMALLINT NOT NULL CHECK (selection_order >= 1 AND selection_order <= 4),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  UNIQUE (zone_key, row_number, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_parc_slot_groups_uuid
  ON public.parc_slot_groups(group_uuid);
CREATE INDEX IF NOT EXISTS idx_parc_slot_groups_zone_row
  ON public.parc_slot_groups(zone_key, row_number);

ALTER TABLE public.parc_slot_groups DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.parc_slot_groups          TO service_role;
GRANT SELECT ON public.parc_slot_groups          TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE parc_slot_groups_id_seq TO service_role;

COMMENT ON TABLE  public.parc_slot_groups IS 'Slots fusionnes en un emplacement logique (camions, larges, 2x2). Primary = selection_order=1, donne le label.';
COMMENT ON COLUMN public.parc_slot_groups.group_uuid IS 'Identifiant logique du groupe partage par tous ses members.';
COMMENT ON COLUMN public.parc_slot_groups.selection_order IS '1=primary (label), 2-4=satellites. Ordre de selection au moment de la creation.';
