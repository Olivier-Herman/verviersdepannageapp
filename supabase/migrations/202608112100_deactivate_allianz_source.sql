-- « Mondial Assistance » et « Allianz » sont la même maison (Olivier 2026-08-11) :
-- même client facturé (AP Solutions GmbH Belgium Branch). Deux clés actives pour
-- une seule réalité, c'est une porte ouverte à une fiche qui échapperait à la
-- grille flux 2, au tarif et aux stats.
--
-- Vérifié AVANT de désactiver :
--   • aucune arrivée ne produit `allianz` : les 4 expéditeurs configurés pointent
--     sur `mondial`, et l'intake Hexalite (processor.ts triggerAllianzFlow) crée
--     ses fiches avec source='mondial' ;
--   • une seule mission historique en `allianz` (#10054940), terminée ET facturée
--     le 10/07 — désactiver la clé ne change pas sa source, elle reste intacte ;
--   • aucune règle tarifaire ne filtre sur `allianz` ;
--   • auto-invoice / auto-eligible traitent DÉJÀ les deux clés comme Hexalite
--     (HEXALITE_SOURCES) et le tableau de bord les additionne → rien à corriger.
--
-- Effet : `allianz` disparaît des sélecteurs de source (création, tarifs). Les
-- données existantes ne bougent pas. Réversible d'un clic dans /admin/sources.
update public.mission_source_catalog
   set active = false, updated_at = now()
 where key = 'allianz';

notify pgrst, 'reload schema';
