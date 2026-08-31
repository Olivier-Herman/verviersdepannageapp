-- Forfait de gardiennage (Olivier 2026-08-31).
--
-- Sur un accident police repris par Ethias ou Kaze, le gardiennage n'est pas
-- compté au jour : c'est un forfait de 220 € HTVA, quel que soit le nombre de
-- jours passés en parc.
--
-- On stocke le MONTANT, pas un booléen : le jour où le forfait change — ou
-- s'ajoute pour un autre assisteur — il se corrige sur la fiche sans toucher au
-- code, et chaque dossier garde la trace du montant qui lui a été appliqué.
-- NULL = pas de forfait, on compte les jours comme d'habitude.
ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS storage_flat_htva numeric;

COMMENT ON COLUMN incoming_missions.storage_flat_htva IS
  'Forfait gardiennage HTVA qui remplace le comptage au jour (NULL = comptage normal). Ex. 220 € pour un accident police repris par Ethias/Kaze.';

-- Cache PostgREST : sans ça la colonne reste invisible et les écritures échouent
-- en silence.
NOTIFY pgrst, 'reload schema';
