-- Date à partir de laquelle un drapeau s'applique aux MISSIONS.
--
-- « Il faut que ça n'interfère pas dans les missions en cours. Les missions en
-- cours ne devront pas être prises dans cette mise à jour » (Olivier
-- 2026-08-21). Un chauffeur qui a commencé une intervention sous l'ancien
-- parcours doit la finir sous l'ancien parcours : changer les écrans sous ses
-- doigts, au bord de la route, c'est la meilleure façon de le bloquer.
--
-- On ne peut pas se servir d'`updated_at` : il bouge à chaque modification du
-- drapeau, donc la ligne de partage se déplacerait toute seule.
ALTER TABLE public.feature_flags
  ADD COLUMN IF NOT EXISTS applies_from TIMESTAMPTZ;

COMMENT ON COLUMN public.feature_flags.applies_from IS
  'Les missions ACCEPTÉES avant cette date gardent l''ancien parcours. NULL = pas de gel.';

NOTIFY pgrst, 'reload schema';
