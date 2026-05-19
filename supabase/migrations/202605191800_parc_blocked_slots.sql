-- ============================================================
-- 202605191800_parc_blocked_slots
-- ============================================================
-- Permet au gestionnaire fourriere (role admin/superadmin ou
-- module 'fourriere') de marquer manuellement des emplacements
-- comme bloques sur /fourriere/plan. Un slot bloque :
--   - est affiche barre rouge + X
--   - refuse les placements via POST /api/parc/place
--   - sera ignore par le futur auto-dispatch
--
-- Cle unique (zone_key, row_number, slot_index) pour permettre
-- un toggle simple (DELETE si existe, INSERT sinon).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.parc_blocked_slots (
  id              BIGSERIAL PRIMARY KEY,
  zone_key        TEXT     NOT NULL REFERENCES public.parc_zones(key) ON DELETE CASCADE,
  row_number      INTEGER  NOT NULL CHECK (row_number > 0),
  slot_index      INTEGER  NOT NULL CHECK (slot_index > 0),
  reason          TEXT,
  blocked_by_user UUID,
  blocked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zone_key, row_number, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_parc_blocked_slots_zone_row
  ON public.parc_blocked_slots(zone_key, row_number);

ALTER TABLE public.parc_blocked_slots DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.parc_blocked_slots          TO service_role;
GRANT SELECT ON public.parc_blocked_slots          TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE parc_blocked_slots_id_seq TO service_role;

COMMENT ON TABLE  public.parc_blocked_slots IS 'Emplacements bloques manuellement par le gestionnaire fourriere (ignores par auto-dispatch + place refuse)';
COMMENT ON COLUMN public.parc_blocked_slots.reason IS 'Motif libre optionnel (ex: panne sol, place reservee, travaux)';
