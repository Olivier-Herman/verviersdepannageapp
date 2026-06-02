-- Olivier 2026-06-02 : catalog des zones de police, gere depuis /admin
-- (pattern zero-hardcode comme police_saisie_motifs).
-- Auparavant : array hardcode dans PoliceClient.tsx.

CREATE TABLE IF NOT EXISTS public.police_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,        -- ex: 'Police Zone Fagnes'
  sort_order  int NOT NULL DEFAULT 100,
  is_default  boolean NOT NULL DEFAULT false, -- la zone preselectionnee dans le form chauffeur
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_police_zones_active_sort
  ON public.police_zones(sort_order, name) WHERE active = true;

ALTER TABLE public.police_zones DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.police_zones TO service_role;
GRANT SELECT ON public.police_zones TO authenticated;

COMMENT ON TABLE public.police_zones IS
  'Zones de police affichees au chauffeur lors de la creation d une mission Police.
   Gerees dans /admin/police-zones. Pattern zero-hardcode (Olivier 2026-06-02).';
COMMENT ON COLUMN public.police_zones.is_default IS
  'Si true, cette zone est pre-selectionnee dans le form chauffeur. Une seule par defaut.';

-- Seed initial : les 2 zones historiques pour ne pas casser l existant
INSERT INTO public.police_zones (name, sort_order, is_default) VALUES
  ('Police Zone Vesdre', 10, true),
  ('Police Zone Fagnes', 20, false)
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
