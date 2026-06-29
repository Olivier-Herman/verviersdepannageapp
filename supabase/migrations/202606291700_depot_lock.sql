-- Verrouillage manuel du dépôt de départ.
-- Quand depot_depart_locked = true, l'auto-réalignement Touring (dépôt le plus
-- proche) ne touche plus la fiche : le choix humain persiste. Olivier 2026-06-29.
ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS depot_depart_locked boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
