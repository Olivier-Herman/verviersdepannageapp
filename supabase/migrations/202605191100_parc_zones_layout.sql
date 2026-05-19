-- ============================================================
-- 202605191100_parc_zones_layout
-- ============================================================
-- Permet de redessiner le plan du parc : chaque zone a une
-- position (x,y) et taille (width,height) en pourcentage du
-- canvas. Edition en mode "Editer le plan" sur /fourriere/plan
-- (admin/superadmin uniquement).
-- ============================================================

ALTER TABLE public.parc_zones
  ADD COLUMN IF NOT EXISTS pos_x   NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pos_y   NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS width   NUMERIC(5,2) NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS height  NUMERIC(5,2) NOT NULL DEFAULT 25;

COMMENT ON COLUMN public.parc_zones.pos_x  IS 'Position X en % du canvas (0-100)';
COMMENT ON COLUMN public.parc_zones.pos_y  IS 'Position Y en % du canvas (0-100)';
COMMENT ON COLUMN public.parc_zones.width  IS 'Largeur en % du canvas (0-100)';
COMMENT ON COLUMN public.parc_zones.height IS 'Hauteur en % du canvas (0-100)';

-- Disposition initiale : grille 5 colonnes x 3 rangees pour les 15 zones.
-- L admin pourra ensuite drag/resize pour reproduire le vrai parc.
UPDATE public.parc_zones SET pos_x = 0,  pos_y = 0,  width = 19, height = 31 WHERE key = 'A';
UPDATE public.parc_zones SET pos_x = 20, pos_y = 0,  width = 19, height = 31 WHERE key = 'B*';
UPDATE public.parc_zones SET pos_x = 40, pos_y = 0,  width = 19, height = 31 WHERE key = 'B';
UPDATE public.parc_zones SET pos_x = 60, pos_y = 0,  width = 19, height = 31 WHERE key = 'C';
UPDATE public.parc_zones SET pos_x = 80, pos_y = 0,  width = 19, height = 31 WHERE key = 'D';
UPDATE public.parc_zones SET pos_x = 0,  pos_y = 33, width = 19, height = 31 WHERE key = 'E';
UPDATE public.parc_zones SET pos_x = 20, pos_y = 33, width = 19, height = 31 WHERE key = 'F';
UPDATE public.parc_zones SET pos_x = 40, pos_y = 33, width = 19, height = 31 WHERE key = 'G';
UPDATE public.parc_zones SET pos_x = 60, pos_y = 33, width = 19, height = 31 WHERE key = 'H';
UPDATE public.parc_zones SET pos_x = 80, pos_y = 33, width = 19, height = 31 WHERE key = 'I';
UPDATE public.parc_zones SET pos_x = 0,  pos_y = 66, width = 19, height = 31 WHERE key = 'J';
UPDATE public.parc_zones SET pos_x = 20, pos_y = 66, width = 19, height = 31 WHERE key = 'K';
UPDATE public.parc_zones SET pos_x = 40, pos_y = 66, width = 19, height = 31 WHERE key = 'L';
UPDATE public.parc_zones SET pos_x = 60, pos_y = 66, width = 19, height = 31 WHERE key = 'Box';
UPDATE public.parc_zones SET pos_x = 80, pos_y = 66, width = 19, height = 31 WHERE key = 'Transit';
