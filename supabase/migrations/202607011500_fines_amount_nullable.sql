-- 202607011500_fines_amount_nullable.sql
-- Capture par lot des PV scannés : le montant n'est pas toujours connu à la
-- capture (surtout les excès de vitesse) → on autorise amount NULL (brouillon).
-- La fiche est « complète » quand amount est renseigné (non NULL) → elle peut
-- alors être envoyée aux achats. Olivier 2026-07-01.

alter table public.fines alter column amount drop not null;

comment on column public.fines.amount is
  'Montant du PV. NULL = brouillon (montant pas encore connu, ex. excès de vitesse). Non NULL = fiche complète, envoyable aux achats.';

notify pgrst, 'reload schema';
