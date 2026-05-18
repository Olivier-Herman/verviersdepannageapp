-- ============================================================
-- 202605182100_fourriere_zones_rows
-- ============================================================
-- Plan visuel du parc fourriere : zones figees + lignes
-- configurables (auto-incrementees A1, A2, ...) avec capacite
-- par ligne. Overflow +N accepte avec warning visuel cote UI.
--
-- - parc_zones    : liste figee (seed inclus)
-- - parc_rows     : N lignes par zone, capacite configurable
-- - incoming_missions.parc_zone_key/parc_row_number/parc_slot_index :
--   localisation actuelle du vehicule
-- ============================================================

-- 1. Zones (liste figee)
CREATE TABLE IF NOT EXISTS public.parc_zones (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  active      BOOLEAN DEFAULT true,
  sort_order  SMALLINT DEFAULT 100,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.parc_zones DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.parc_zones TO service_role;
GRANT SELECT ON public.parc_zones TO authenticated;

INSERT INTO public.parc_zones (key, label, sort_order) VALUES
  ('A',       'A',        10),
  ('B*',      'B*',       20),
  ('B',       'B',        30),
  ('C',       'C',        40),
  ('D',       'D',        50),
  ('E',       'E',        60),
  ('F',       'F',        70),
  ('G',       'G',        80),
  ('H',       'H',        90),
  ('I',       'I',       100),
  ('J',       'J',       110),
  ('K',       'K',       120),
  ('L',       'L',       130),
  ('Box',     'Box',     140),
  ('Transit', 'Transit', 150)
ON CONFLICT (key) DO NOTHING;

-- 2. Lignes (auto-incrementees par zone)
CREATE TABLE IF NOT EXISTS public.parc_rows (
  id          BIGSERIAL PRIMARY KEY,
  zone_key    TEXT NOT NULL REFERENCES public.parc_zones(key) ON DELETE CASCADE,
  row_number  SMALLINT NOT NULL CHECK (row_number > 0),
  capacity    SMALLINT NOT NULL CHECK (capacity > 0),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (zone_key, row_number)
);
CREATE INDEX IF NOT EXISTS idx_parc_rows_zone ON public.parc_rows(zone_key);
ALTER TABLE public.parc_rows DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.parc_rows TO service_role;
GRANT SELECT ON public.parc_rows TO authenticated;

-- 3. Localisation parc sur les missions
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS parc_zone_key   TEXT     REFERENCES public.parc_zones(key) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parc_row_number SMALLINT,
  ADD COLUMN IF NOT EXISTS parc_slot_index SMALLINT;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_parc
  ON public.incoming_missions(parc_zone_key, parc_row_number)
  WHERE parc_zone_key IS NOT NULL;

COMMENT ON COLUMN public.incoming_missions.parc_zone_key   IS 'Zone du parc fourriere (ex: A, B*, Transit)';
COMMENT ON COLUMN public.incoming_missions.parc_row_number IS 'Numero de ligne dans la zone (1, 2, 3...). Combine avec zone_key -> A1, A2, etc.';
COMMENT ON COLUMN public.incoming_missions.parc_slot_index IS 'Position dans la ligne (1-based). Peut depasser la capacite -> overflow';
