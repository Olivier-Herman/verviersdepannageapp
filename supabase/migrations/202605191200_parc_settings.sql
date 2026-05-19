-- ============================================================
-- 202605191200_parc_settings
-- ============================================================
-- Singleton de configuration du canvas du parc. Permet a l admin
-- de definir la hauteur du canvas (en pixels) pour adapter le plan
-- a la geometrie reelle du parking (~ 50 rangees en hauteur dans
-- le cas Verviers, donc canvas tres allonge verticalement).
--
-- Largeur = automatique (100% du conteneur). Seule la hauteur est
-- configurable car c est la dimension qui varie.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.parc_settings (
  id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  canvas_height_px  INTEGER NOT NULL DEFAULT 2400 CHECK (canvas_height_px BETWEEN 400 AND 8000),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.parc_settings DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.parc_settings TO service_role;
GRANT SELECT ON public.parc_settings TO authenticated;

INSERT INTO public.parc_settings (id, canvas_height_px) VALUES (1, 2400)
ON CONFLICT (id) DO NOTHING;
