-- Olivier 10/09/2026 : « le type de gardiennage d'un Siabis couvert (assistance) doit être
-- Assistance, pas Siabis. Le type Siabis est uniquement pour les SNC. »
-- Les deux volets concernés (2CBP609, 2BDQ118), ouverts et non facturés, passent en assistance.
update incoming_missions g
   set mission_type = 'assistance', updated_at = now()
  from incoming_missions r
 where r.id = g.parc_origin_mission_id and g.dossier_leg and g.mission_type = 'siabis'
   and r.source = 'sia_couvert'
   and g.invoice_number is null and g.invoice_odoo_id is null
   and not exists (select 1 from mission_billed_items b where b.mission_id = g.id);
