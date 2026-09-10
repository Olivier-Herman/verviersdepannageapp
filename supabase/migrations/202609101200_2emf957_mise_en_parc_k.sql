-- 10/09/2026 — 2EMF957 (fiche #10138734, Siabis couvert / Touring) : Matthieu a validé la
-- clôture Touring « mise en parc » (code 05 à 11h37) mais la mise en parc VD Soft n'a
-- jamais été enregistrée (aucun pointage « park » au journal). Olivier : « elle devrait
-- être en parc de relivraison ». Même sémantique que « Forcer en parc » du dispatch :
-- dépôt Pepinster, zone K, REM+REL, destination = parc, ancienne destination = relivraison.
update incoming_missions
   set status = 'parked', parked_at = now(),
       depot_depart_id = '19cbaeae-4cb2-4af4-a4c1-85922532dfe7',
       parc_zone_key = 'K', parc_row_number = null, parc_slot_index = null,
       mission_type = 'REM+REL',
       redelivery_address = coalesce(redelivery_address, destination_address),
       destination_address = 'Rue Lefin 12, 4860 Pepinster, Belgique',
       updated_at = now()
 where mission_number = 10138734 and status = 'in_progress';
insert into mission_logs (mission_id, action, notes, metadata)
select id, 'park', 'Véhicule mis en dépôt — zone K (régularisé par Claude à la demande d''Olivier : la clôture Touring 05 de Matthieu à 11h37 n''avait pas été suivie de la mise en parc VD Soft).', '{"by":"Claude","zone":"K"}'::jsonb
  from incoming_missions where mission_number = 10138734;
