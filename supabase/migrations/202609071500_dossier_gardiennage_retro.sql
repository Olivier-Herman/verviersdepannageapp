-- ============================================================================
-- Vue dossier — étape 1 (suite) : la création d'une fiche gardiennage devient
-- une FONCTION réutilisable (le trigger l'appelle), et on rétro-crée les
-- gardiennages des véhicules ACTUELLEMENT au parc (Olivier 07/09/2026 :
-- « si possible oui »). Statut 'gardiennage' + dossier_leg → invisibles des
-- modules non basculés, donc sans risque pour l'exploitation.
-- On ne reconstitue PAS l'historique des dossiers déjà sortis.
-- ============================================================================

CREATE OR REPLACE FUNCTION dossier_gardiennage_open(p_mission_id uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  m       incoming_missions%ROWTYPE;
  v_root  incoming_missions%ROWTYPE;
  v_root_id uuid;
  v_n     int;
  v_id    uuid;
BEGIN
  SELECT * INTO m FROM incoming_missions WHERE id = p_mission_id;
  IF m.id IS NULL OR m.dossier_leg OR m.source = 'gardiennage' THEN RETURN NULL; END IF;
  v_root_id := COALESCE(m.parent_mission_id, m.id);
  SELECT * INTO v_root FROM incoming_missions WHERE id = v_root_id;
  SELECT count(*) INTO v_n FROM incoming_missions WHERE parent_mission_id = v_root_id AND dossier_leg;

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
    COALESCE(m.parked_at, m.received_at, now()), COALESCE(m.parked_at, m.received_at, now()), COALESCE(m.parked_at, m.received_at, now()),
    m.parc_zone_key, m.parc_row_number, m.parc_slot_index, m.park_stage_id, m.park_stage_name,
    m.depot_depart_id, m.key_location, m.keys_digibox_slot, m.saisie_key_hook, m.is_rollable, m.vehicle_location,
    m.vehicle_plate, m.vehicle_brand, m.vehicle_model, m.vehicle_vin, m.vehicle_vin_partial, m.vehicle_fuel, m.vehicle_gearbox, m.vehicle_class, m.vehicle_mileage,
    m.client_name, m.client_phone, m.client_address, m.assisted_name, m.assisted_phone,
    COALESCE(m.billed_to_id, v_root.billed_to_id), COALESCE(m.billed_to_name, v_root.billed_to_name),
    COALESCE(m.dossier_number, v_root.dossier_number), COALESCE(m.contract_label, v_root.contract_label),
    m.incident_address, m.incident_type, m.destination_address,
    m.redelivery_address, m.redelivery_lat, m.redelivery_lng, m.redelivery_info, m.garage_reopen_date,
    COALESCE(m.driver_photos, v_root.driver_photos), COALESCE(m.remarks_general, v_root.remarks_general),
    COALESCE(m.odoo_vehicle_id, v_root.odoo_vehicle_id), COALESCE(m.storage_waived, false), m.storage_flat_htva,
    1
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Le trigger délègue la création à la fonction (même logique, un seul endroit).
CREATE OR REPLACE FUNCTION dossier_gardiennage_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_root_id     uuid;
  v_open_id     uuid;
  v_open_origin uuid;
  v_exit_at     timestamptz;
  v_reason      text;
  v_rel_pending boolean;
BEGIN
  IF NEW.dossier_leg OR NEW.source = 'gardiennage' THEN
    RETURN NEW;
  END IF;
  v_root_id := COALESCE(NEW.parent_mission_id, NEW.id);

  BEGIN
    -- 1. ENTRÉE
    IF NEW.status = 'parked' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'parked') THEN
      SELECT id, parc_origin_mission_id INTO v_open_id, v_open_origin FROM incoming_missions
        WHERE parent_mission_id = v_root_id AND dossier_leg AND parc_exit_at IS NULL
        ORDER BY parked_at DESC LIMIT 1;
      IF v_open_id IS NOT NULL AND v_open_origin IS DISTINCT FROM NEW.id THEN
        UPDATE incoming_missions
          SET parc_exit_at = COALESCE(NEW.parked_at, now()), parc_exit_reason = 'reparc', updated_at = now()
          WHERE id = v_open_id;
        v_open_id := NULL;
      END IF;
      IF v_open_id IS NULL THEN
        PERFORM dossier_gardiennage_open(NEW.id);
      ELSE
        UPDATE incoming_missions SET
          parc_zone_key = NEW.parc_zone_key, parc_row_number = NEW.parc_row_number, parc_slot_index = NEW.parc_slot_index,
          key_location = NEW.key_location, updated_at = now()
          WHERE id = v_open_id;
      END IF;

    -- 2. AU PARC : zone / clés / relivraison / client bougent
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'parked' AND OLD.status = 'parked' AND (
         NEW.parc_zone_key IS DISTINCT FROM OLD.parc_zone_key
      OR NEW.parc_row_number IS DISTINCT FROM OLD.parc_row_number
      OR NEW.parc_slot_index IS DISTINCT FROM OLD.parc_slot_index
      OR NEW.key_location IS DISTINCT FROM OLD.key_location
      OR NEW.keys_digibox_slot IS DISTINCT FROM OLD.keys_digibox_slot
      OR NEW.redelivery_address IS DISTINCT FROM OLD.redelivery_address
      OR NEW.garage_reopen_date IS DISTINCT FROM OLD.garage_reopen_date
      OR NEW.billed_to_id IS DISTINCT FROM OLD.billed_to_id
      OR NEW.storage_waived IS DISTINCT FROM OLD.storage_waived
      OR NEW.storage_flat_htva IS DISTINCT FROM OLD.storage_flat_htva
    ) THEN
      UPDATE incoming_missions g SET
        parc_zone_key = NEW.parc_zone_key, parc_row_number = NEW.parc_row_number, parc_slot_index = NEW.parc_slot_index,
        key_location = NEW.key_location, keys_digibox_slot = NEW.keys_digibox_slot,
        redelivery_address = NEW.redelivery_address, redelivery_lat = NEW.redelivery_lat, redelivery_lng = NEW.redelivery_lng,
        garage_reopen_date = NEW.garage_reopen_date,
        billed_to_id   = CASE WHEN g.billed_to_id IS NOT DISTINCT FROM OLD.billed_to_id THEN NEW.billed_to_id ELSE g.billed_to_id END,
        billed_to_name = CASE WHEN g.billed_to_id IS NOT DISTINCT FROM OLD.billed_to_id THEN NEW.billed_to_name ELSE g.billed_to_name END,
        storage_waived = NEW.storage_waived, storage_flat_htva = NEW.storage_flat_htva,
        updated_at = now()
        WHERE g.parent_mission_id = v_root_id AND g.dossier_leg AND g.parc_exit_at IS NULL;
    END IF;

    -- 3. SORTIE
    IF TG_OP = 'UPDATE' AND OLD.status = 'parked' AND NEW.status IS DISTINCT FROM 'parked' THEN
      SELECT EXISTS (
        SELECT 1 FROM incoming_missions c
        WHERE c.parent_mission_id = v_root_id AND NOT c.dossier_leg AND c.source <> 'gardiennage'
          AND c.loaded_at IS NULL
          AND c.status NOT IN ('cancelled', 'ignored', 'completed', 'to_invoice')
      ) INTO v_rel_pending;
      IF NOT (NEW.status IN ('completed', 'to_invoice') AND v_rel_pending) THEN
        v_exit_at := CASE
          WHEN NEW.loaded_at IS NOT NULL AND NEW.loaded_at > COALESCE(NEW.parked_at, OLD.parked_at, NEW.loaded_at - interval '1 second') THEN NEW.loaded_at
          ELSE now() END;
        v_reason := CASE NEW.status
          WHEN 'delivering' THEN 'relivraison'
          WHEN 'cancelled'  THEN 'annulation'
          WHEN 'ignored'    THEN 'annulation'
          WHEN 'to_invoice' THEN 'sortie'
          WHEN 'completed'  THEN 'sortie'
          ELSE 'correction' END;
        UPDATE incoming_missions
          SET parc_exit_at = v_exit_at, parc_exit_reason = v_reason, updated_at = now()
          WHERE parent_mission_id = v_root_id AND dossier_leg AND parc_exit_at IS NULL;
      END IF;
    END IF;

    -- 4. Une REL charge le véhicule
    IF TG_OP = 'UPDATE' AND NEW.parent_mission_id IS NOT NULL
       AND NEW.loaded_at IS NOT NULL AND OLD.loaded_at IS NULL THEN
      UPDATE incoming_missions
        SET parc_exit_at = NEW.loaded_at, parc_exit_reason = 'relivraison', updated_at = now()
        WHERE parent_mission_id = v_root_id AND dossier_leg AND parc_exit_at IS NULL;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[dossier_gardiennage_sync] mission % : %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ── Rétro-création : un gardiennage ouvert par véhicule actuellement au parc ─
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT m.id FROM incoming_missions m
    WHERE m.status = 'parked' AND NOT m.dossier_leg AND m.source <> 'gardiennage'
      AND COALESCE(m.vehicle_plate, '') <> 'TEST'
      AND NOT EXISTS (
        SELECT 1 FROM incoming_missions g
        WHERE g.parent_mission_id = COALESCE(m.parent_mission_id, m.id) AND g.dossier_leg AND g.parc_exit_at IS NULL
      )
    ORDER BY m.parked_at NULLS LAST
  LOOP
    BEGIN
      PERFORM dossier_gardiennage_open(r.id);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[retro gardiennage] % : %', r.id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE '[retro gardiennage] % fiche(s) gardiennage créée(s)', n;
END $$;

NOTIFY pgrst, 'reload schema';
