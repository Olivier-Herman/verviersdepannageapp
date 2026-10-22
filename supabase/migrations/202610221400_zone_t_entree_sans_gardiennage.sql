-- Zone T : une fiche qui revient au statut « au parc » directement en zone T (levée temporaire, facture
-- validée → settleRootIfDone) n'ouvre PAS de gardiennage : le véhicule est chez le garagiste (Olivier 22/10/2026).
-- Seul changement : la condition d'ENTRÉE exclut la zone T. Le retour (T → une de nos zones) rouvre le
-- gardiennage via dossier_gardiennage_zone_t.
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
    IF NEW.status = 'parked' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'parked') AND NEW.parc_zone_key IS DISTINCT FROM 'T' THEN
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

notify pgrst, 'reload schema';
