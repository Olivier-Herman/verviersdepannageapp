-- 2JPR337 : la fiche VAB #10137465 en réserve porte le marqueur que
-- createRelivraisonMission cherche (type REL + incident_type relivraison + ignored).
update incoming_missions set incident_type = 'relivraison', updated_at = now()
 where mission_number = 10137465 and status = 'ignored' and mission_type = 'REL';
