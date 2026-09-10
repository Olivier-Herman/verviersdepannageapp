-- WW734QC (Olivier 10/09/2026) : « le calcul des jours de gardiennage de la vue liste n'est pas
-- le bon alors que dans la fiche c'est ok ». 252 fiches mères en parc n'ont pas de parked_at
-- (fiches migrées / créées avant la règle), seul leur volet gardiennage ouvert en a un — la fiche
-- lit le volet, la liste lisait la fiche mère. On recopie la date d'entrée du volet ouvert.
update incoming_missions r
   set parked_at = g.parked_at, updated_at = now()
  from incoming_missions g
 where g.parc_origin_mission_id = r.id and g.dossier_leg and g.parc_exit_at is null and g.parked_at is not null
   and r.status = 'parked' and not r.dossier_leg and r.parked_at is null;
-- Reste sans volet daté : date d'intervention, sinon réception.
update incoming_missions
   set parked_at = coalesce(intervention_date, received_at), updated_at = now()
 where status = 'parked' and not dossier_leg and parked_at is null and coalesce(intervention_date, received_at) is not null;
select count(*) as encore_sans_date from incoming_missions where status = 'parked' and not dossier_leg and parked_at is null;
