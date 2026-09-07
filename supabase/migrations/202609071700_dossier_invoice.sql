-- ============================================================================
-- Vue dossier — étape 2 : facturation par dossier (Olivier 07/09/2026).
--   • mission_billed_items : trace de la facture Odoo créée directement
--     (invoice_odoo_id) + lettre du groupe couvert.
--   • dossier_gardiennage_open(p_mission_id, p_from) : une période facturée =
--     un groupe. Facturer un gardiennage en cours le ferme à maintenant et en
--     rouvre un nouveau qui démarre à p_from (le trigger continue d'appeler la
--     fonction sans p_from → date d'entrée de la fiche).
-- ============================================================================

ALTER TABLE mission_billed_items
  ADD COLUMN IF NOT EXISTS invoice_odoo_id integer,
  ADD COLUMN IF NOT EXISTS dossier_letter  text;

CREATE INDEX IF NOT EXISTS mission_billed_items_invoice_odoo_idx ON mission_billed_items (invoice_odoo_id);

DROP FUNCTION IF EXISTS dossier_gardiennage_open(uuid);
CREATE OR REPLACE FUNCTION dossier_gardiennage_open(p_mission_id uuid, p_from timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  m         incoming_missions%ROWTYPE;
  v_root    incoming_missions%ROWTYPE;
  v_root_id uuid;
  v_n       int;
  v_id      uuid;
  v_from    timestamptz;
BEGIN
  SELECT * INTO m FROM incoming_missions WHERE id = p_mission_id;
  IF m.id IS NULL OR m.dossier_leg OR m.source = 'gardiennage' THEN RETURN NULL; END IF;
  v_root_id := COALESCE(m.parent_mission_id, m.id);
  SELECT * INTO v_root FROM incoming_missions WHERE id = v_root_id;
  SELECT count(*) INTO v_n FROM incoming_missions WHERE parent_mission_id = v_root_id AND dossier_leg;
  v_from := COALESCE(p_from, m.parked_at, m.received_at, now());

  INSERT INTO incoming_missions (
    source, source_format, mission_type, status, dossier_leg,
    parent_mission_id, parc_origin_mission_id, external_id,
    received_at, intervention_date, parked_at,
    parc_zone_key, parc_row_number, parc_slot_index, park_stage_id, park_stage_name,
    depot_depart_id, key_location, keys_digibox_slot, saisie_key_hook, is_rollable, vehicle_location,
    vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, vehicle_vin_partial, vehicle_fuel, vehicle_gearbox, vehicle_class, vehicle_mileage,
    client_name, client_phone, client_address, assisted_name, assisted_phone,
    billed_to_id, billed_to_name, dossier_number, contract_label,
    incident_address, incident_type, destination_address,
    redelivery_address, redelivery_lat, redelivery_lng, redelivery_info, garage_reopen_date,
    driver_photos, remarks_general,
    odoo_vehicle_id, storage_waived, storage_flat_htva,
    parse_confidence
  ) VALUES (
    'gardiennage', 'dossier_leg', dossier_gardiennage_regime(v_root.source), 'gardiennage', true,
    v_root_id, m.id, 'GARD-' || COALESCE(v_root.external_id, left(v_root_id::text, 8)) || '-' || (v_n + 1),
    v_from, v_from, v_from,
    m.parc_zone_key, m.parc_row_number, m.parc_slot_index, m.park_stage_id, m.park_stage_name,
    m.depot_depart_id, m.key_location, m.keys_digibox_slot, m.saisie_key_hook, m.is_rollable, m.vehicle_location,
    m.vehicle_plate, m.vehicle_brand, m.vehicle_model, m.vehicle_vin, m.vehicle_vin_partial, m.vehicle_fuel, m.vehicle_gearbox, m.vehicle_class, m.vehicle_mileage,
    m.client_name, m.client_phone, m.client_address, m.assisted_name, m.assisted_phone,
    COALESCE(m.billed_to_id, v_root.billed_to_id), COALESCE(m.billed_to_name, v_root.billed_to_name),
    COALESCE(m.dossier_number, v_root.dossier_number), COALESCE(m.contract_label, v_root.contract_label),
    m.incident_address, m.incident_type, m.destination_address,
    m.redelivery_address, m.redelivery_lat, m.redelivery_lng, m.redelivery_info, m.garage_reopen_date,
    COALESCE(m.driver_photos, v_root.driver_photos), COALESCE(m.remarks_general, v_root.remarks_general),
    COALESCE(m.odoo_vehicle_id, v_root.odoo_vehicle_id), COALESCE(m.storage_waived, false),
    -- Un forfait de gardiennage ne se facture qu'une fois : la période suivante
    -- repart au comptage journalier.
    CASE WHEN p_from IS NULL THEN m.storage_flat_htva ELSE NULL END,
    1
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
