-- Domaine — Vente d'épaves : 2 champs supplémentaires sur la fiche saisie.
--   domaine_ref            = « N° véhicule » de la 1re colonne du mail = RÉFÉRENCE
--                            DOMAINE (ex. 187, 81…), PAS la plaque.
--   domaine_sortie_reelle_date = date de sortie RÉELLE (physique) du véhicule.
--                            N'a AUCUN impact sur le gardiennage facturé (qui reste
--                            calculé remise → enlèvement = Date OUT). Quand elle est
--                            renseignée, la fiche passe en « à facturer » (to_invoice)
--                            avec un cachet « Domaine » côté facturation.

--   domaine_prepare_at     = horodatage « Préparation OK » (véhicule préparé pour
--                            l'enlèvement). Ligne verte + bouton masqué côté Vente
--                            d'épave une fois posé.

alter table incoming_missions
  add column if not exists domaine_ref                 text,
  add column if not exists domaine_sortie_reelle_date  date,
  add column if not exists domaine_prepare_at          timestamptz;

notify pgrst, 'reload schema';
