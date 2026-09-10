-- 10/09/2026 — 2EMF957 : l'action Touring de livraison depuis notre parc (fiche #10138828,
-- validée entre-temps) devient la RELIVRAISON du dossier #10138734 (véhicule en parc K),
-- à assigner à un autre chauffeur que Matthieu (Olivier : « ce n'est pas lui qui va le faire »).
-- Départ = notre parc, destination = le garage Touring. Même n° Touring, clôture COMEX inchangée.
update incoming_missions
   set parent_mission_id = (select id from incoming_missions where mission_number = 10138734),
       mission_type = 'REL', incident_type = 'relivraison',
       incident_description = 'Relivraison après mise en parc — Mission parent : 2026555964MA (action Touring 2026555775MA reprise)',
       incident_address = 'Rue Lefin 12, 4860 Pepinster, Belgique',
       assigned_to = null, updated_at = now()
 where mission_number = 10138828 and status in ('new', 'dispatching');
insert into mission_logs (mission_id, action, notes, metadata)
select id, 'attached_to_dossier', 'Action Touring de livraison rattachée comme relivraison du dossier #10138734 (2EMF957, véhicule en parc K) — à assigner (Olivier 10/09).', '{"by":"Claude"}'::jsonb
  from incoming_missions where mission_number = 10138828;
insert into mission_logs (mission_id, action, notes)
select id, 'request_relivraison', 'Relivraison = action Touring #10138828 (livraison parc → Technical Pneus), à assigner depuis « À relivrer » ou le dispatch.'
  from incoming_missions where mission_number = 10138734;
