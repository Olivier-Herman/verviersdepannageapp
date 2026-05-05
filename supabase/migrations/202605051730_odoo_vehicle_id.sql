-- Persistance du lien Odoo véhicule sur incoming_missions
-- Une fois que le dispatcher a confirmé qu'un véhicule existant correspond,
-- on stocke l'id Odoo pour ne plus reproposer la liste à chaque ouverture.

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS odoo_vehicle_id INT;

COMMENT ON COLUMN incoming_missions.odoo_vehicle_id IS 'fleet.vehicle.id sur Odoo, persiste apres confirmation du dispatcher';
