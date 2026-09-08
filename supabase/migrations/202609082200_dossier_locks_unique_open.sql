-- Lot 1 de l'audit facturation (Olivier 08/09/2026, décisions D7) :
--  • verrou applicatif par dossier pendant une facturation (double clic, deux
--    utilisateurs) ;
--  • jamais deux périodes de gardiennage ouvertes pour un même dossier, et une
--    réouverture après facturation seulement si le véhicule est encore au parc.
CREATE TABLE IF NOT EXISTS public.dossier_locks (
  root_id   uuid PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by uuid
);
ALTER TABLE public.dossier_locks DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dossier_locks TO service_role;

CREATE OR REPLACE FUNCTION dossier_lock_acquire(p_root uuid, p_by uuid DEFAULT NULL, p_ttl_seconds int DEFAULT 90) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE v_at timestamptz;
BEGIN
  INSERT INTO dossier_locks (root_id, locked_at, locked_by) VALUES (p_root, now(), p_by)
  ON CONFLICT (root_id) DO NOTHING;
  IF FOUND THEN RETURN true; END IF;
  SELECT locked_at INTO v_at FROM dossier_locks WHERE root_id = p_root FOR UPDATE;
  IF v_at < now() - make_interval(secs => p_ttl_seconds) THEN
    UPDATE dossier_locks SET locked_at = now(), locked_by = p_by WHERE root_id = p_root;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION dossier_lock_release(p_root uuid) RETURNS void
LANGUAGE sql AS $$ DELETE FROM dossier_locks WHERE root_id = p_root; $$;

-- Réouverture d'une période (p_from fourni) : refusée si une période est déjà
-- ouverte sur le dossier, ou si la fiche d'origine n'est plus au parc.
CREATE OR REPLACE FUNCTION dossier_gardiennage_open_guard() RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;

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
  -- Gardes (audit 08/09/2026) : une seule période ouverte par dossier ; après
  -- une facturation (p_from fourni), on ne rouvre que si le véhicule est encore au parc.
  IF EXISTS (SELECT 1 FROM incoming_missions WHERE parent_mission_id = v_root_id AND dossier_leg AND parc_exit_at IS NULL) THEN RETURN NULL; END IF;
  IF p_from IS NOT NULL AND m.status <> 'parked' THEN RETURN NULL; END IF;

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

DROP FUNCTION IF EXISTS dossier_gardiennage_open_guard();
NOTIFY pgrst, 'reload schema';
