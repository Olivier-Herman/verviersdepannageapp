-- 09/09/2026 — Olivier : « les 16 véhicules tu peux les sortir du parc » puis
-- « il faut les archiver sans facture ». Les 16 dossiers sortis du parc à 14h13
-- (inventaire des fiches sans zone) passent sans frais et sont archivés ; les
-- volets gardiennage sont marqués « gardiennage offert ». Même sémantique que le
-- bouton « Sans frais » de l'app (no_charge_at + champs facture vidés).
create temp table t_legs as
  select id, parc_origin_mission_id as root_id from incoming_missions
  where dossier_leg and parc_exit_reason = 'sortie'
    and parc_exit_at between '2026-09-09 14:13:00' and '2026-09-09 14:14:00';
create temp table t_roots as
  select distinct r.id, r.status from incoming_missions r join t_legs l on l.root_id = r.id;

update incoming_missions
   set status = 'completed', no_charge_at = now(),
       no_charge_reason = 'Sortie du parc sans facture (inventaire des fiches sans zone, décision Olivier 09/09)',
       invoice_method = null, invoice_number = null, invoice_odoo_id = null, invoice_url = null, updated_at = now()
 where id in (select id from t_roots where status = 'to_invoice');

update incoming_missions
   set storage_waived = true, no_charge_at = now(),
       no_charge_reason = 'Sortie du parc sans facture (inventaire des fiches sans zone, décision Olivier 09/09)',
       archived_at = now(), updated_at = now()
 where id in (select id from t_legs);

update incoming_missions set archived_at = now(), updated_at = now() where id in (select id from t_roots);

insert into mission_logs (mission_id, action, notes, metadata)
select id, 'no_charge',
       'Sortie du parc sans facture et archivage — inventaire des fiches sans zone, décision Olivier 09/09 (gardiennage offert)',
       '{"reason":"inventaire_sans_zone"}'::jsonb
  from t_roots;
