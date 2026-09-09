-- 202609081200_saisie_client_period
--
-- Olivier 08/09/2026 (WW907HL) :
--   • On peut TOUJOURS facturer le propriétaire d'une saisie, même sans levée
--     (le policier exige parfois le paiement avant la levée ; le véhicule
--     reste en parc). Ce que le client a payé — dépannage, gardiennage jusqu'à
--     une date — sort de l'état de frais : le Parquet ne paie que le solde.
--   • Levée de saisie : le dossier Parquet s'arrête ; les états de frais déjà
--     partis sont À ANNULER (statut 'a_annuler' → 'annule' quand la note de
--     crédit est faite) et tout est refacturé au client.

alter table public.saisie_dossiers
  add column if not exists client_billed_to_date     date,       -- gardiennage payé par le propriétaire jusqu'à cette date
  add column if not exists depannage_billed_client   boolean not null default false;

notify pgrst, 'reload schema';
