-- Olivier 10/09/2026 : « les fiches qui ont eu un basculement automatique, tu peux les remettre
-- en état initial ». Le cron mg-to-avp (supprimé le 10/09) avait passé des Mal garées en AVP
-- après 60 jours, sans document. Retour à police_mg pour celles encore en AVP SANS réquisitoire
-- (un réquisitoire « abandon » reçu justifie l'AVP) et NON facturées (l'historique facturé reste).
create temp table t_revert as
  select distinct m.id
    from mission_logs l join incoming_missions m on m.id = l.mission_id
   where l.action = 'auto_mg_to_avp' and m.source = 'police_avp'
     and m.requisitoire_at is null and m.invoice_number is null and m.invoice_odoo_id is null;
update incoming_missions set source = 'police_mg', updated_at = now() where id in (select id from t_revert);
insert into mission_logs (mission_id, action, notes, metadata)
select id, 'source_changed', 'Source remise en Mal garée : la bascule automatique en AVP à 60 jours (cron retiré le 10/09) est annulée — Olivier 10/09/2026. Un passage en AVP se fera sur réquisitoire « abandon ».', '{"from":"police_avp","to":"police_mg","by":"Claude"}'::jsonb
  from t_revert;
select count(*) as remises_en_mal_garee from t_revert;
