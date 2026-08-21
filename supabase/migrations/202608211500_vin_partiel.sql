-- Les 5 derniers du châssis saisis par le chauffeur.
--
-- L'écran de clôture demande « 5 derniers du VIN », mais `vehicle_vin` n'accepte
-- qu'un châssis COMPLET (17 caractères) : les assistances le lisent tel quel, on
-- ne peut pas y mettre un fragment. Résultat, ce que le chauffeur tapait était
-- perdu, et l'écran suivant le redemandait (Olivier 2026-08-21, en test).
-- Ici on le garde tel quel — utile pour préremplir, et pour VAB qui ne demande
-- justement que les 3 derniers.
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS vehicle_vin_partial TEXT;

COMMENT ON COLUMN public.incoming_missions.vehicle_vin_partial IS
  'Derniers caractères du châssis saisis par le chauffeur (fragment, pas un VIN complet).';

NOTIFY pgrst, 'reload schema';
