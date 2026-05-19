-- ============================================================
-- 202605191300_parc_zones_layout_options
-- ============================================================
-- Options d affichage par zone :
-- 1. slot_direction (ltr/rtl) : sens des voitures dans une ligne.
--    Utile pour les zones "miroir" cote droit du parc ou la
--    voiture #1 doit visuellement etre la plus a droite.
-- 2. row_layout (horizontal/vertical) : orientation des rangees.
--    Default horizontal (rangee = ligne horizontale, rangees
--    empilees verticalement). Vertical = rangee = colonne, rangees
--    cote a cote. Pour zones type F ou L orientees differemment.
-- ============================================================

ALTER TABLE public.parc_zones
  ADD COLUMN IF NOT EXISTS slot_direction TEXT NOT NULL DEFAULT 'ltr'
    CHECK (slot_direction IN ('ltr', 'rtl'));

ALTER TABLE public.parc_zones
  ADD COLUMN IF NOT EXISTS row_layout TEXT NOT NULL DEFAULT 'horizontal'
    CHECK (row_layout IN ('horizontal', 'vertical'));

COMMENT ON COLUMN public.parc_zones.slot_direction IS
  'Sens d affichage des slots dans une ligne : ltr (gauche->droite) ou rtl (droite->gauche). Indexation BDD inchangee : slot 1 reste le premier vehicule.';
COMMENT ON COLUMN public.parc_zones.row_layout IS
  'Orientation des rangees : horizontal (rangee = ligne, default) ou vertical (rangee = colonne).';
