-- ============================================================================
-- Vue dossier — étape 1 : le gardiennage devient une FICHE (Olivier 07/09/2026)
--
-- Chaque séjour au parc = une fiche `source='gardiennage'`, enfant du REM racine
-- (parent_mission_id = racine, comme les REL), régime = mission_type
-- (assistance | saisie | siabis | autre) déduit de la SOURCE DU 1er REM.
--
-- MIROIR : en étape 1 la fiche REM reste `parked` (tous les modules la lisent
-- encore). La fiche gardiennage porte `dossier_leg = true` et le statut
-- 'gardiennage' — un statut qu'AUCUNE liste existante ne connaît, donc elle
-- n'apparaît nulle part tant qu'un module n'a pas basculé. Ouverte/fermée se
-- lit sur `parc_exit_at`.
--
-- Un trigger fait tout : il couvre les ~20 chemins qui écrivent status='parked'
-- (app chauffeur, forcer en parc, fourrière, migrations, réquisitoire, Franco…)
-- sans toucher au code. Il ne doit JAMAIS faire échouer la mise en parc :
-- toute erreur est avalée en WARNING.
-- ============================================================================

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS dossier_leg            boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parc_exit_at           timestamptz,
  ADD COLUMN IF NOT EXISTS parc_exit_reason       text,
  ADD COLUMN IF NOT EXISTS parc_origin_mission_id uuid;

CREATE INDEX IF NOT EXISTS incoming_missions_dossier_leg_open_idx
  ON incoming_missions (parent_mission_id)
  WHERE dossier_leg AND parc_exit_at IS NULL;

-- ── Régime de gardiennage d'après la source du 1er REM ─────────────────────
CREATE OR REPLACE FUNCTION dossier_gardiennage_regime(p_source text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_source = 'police_saisie'                                        THEN 'saisie'
    WHEN p_source IN ('sia_couvert', 'sia_noncouvert', 'siabis', 'police_snc') THEN 'siabis'
    -- Accident et AVP en « autre » (Olivier 07/09/2026), avec le reste du non-assistance.
    WHEN p_source LIKE 'police_%' OR p_source LIKE 'garage%' OR p_source LIKE 'legacy_%'
      OR p_source IN ('prive', 'fourriere_parc', 'francofolies', 'gardiennage', 'unknown', 'circuit', 'pv_assistance')
                                                                           THEN 'autre'
    ELSE 'assistance'
  END
$$;

-- ── Trigger : entrée / sortie / changement de zone ─────────────────────────
CREATE OR REPLACE FUNCTION dossier_gardiennage_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_root_id   uuid;
  v_root      incoming_missions%ROWTYPE;
  v_open_id   uuid;
  v_open_origin uuid;
  v_n         int;
  v_exit_at   timestamptz;
  v_reason    text;
  v_rel_pending boolean;
BEGIN
  -- Les fiches gardiennage elles-mêmes ne déclenchent rien (ni les 3 fiches
  -- « Gardiennage » créées à la main avant ce chantier).
  IF NEW.dossier_leg OR NEW.source = 'gardiennage' THEN
    RETURN NEW;
  END IF;

  v_root_id := COALESCE(NEW.parent_mission_id, NEW.id);

  BEGIN
    -- ── 1. ENTRÉE au parc ─────────────────────────────────────────────────
    IF NEW.status = 'parked' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'parked') THEN
      SELECT * INTO v_root FROM incoming_missions WHERE id = v_root_id;
      SELECT id, parc_origin_mission_id INTO v_open_id, v_open_origin FROM incoming_missions
        WHERE parent_mission_id = v_root_id AND dossier_leg AND parc_exit_at IS NULL
        ORDER BY parked_at DESC LIMIT 1;

      IF v_open_id IS NOT NULL AND v_open_origin IS DISTINCT FROM NEW.id THEN
        -- Un gardiennage est encore ouvert pour une autre fiche du dossier
        -- (ex. la REL est remise en parc alors que celui du REM n'a pas été
        -- fermé) : un seul gardiennage ouvert par dossier → on ferme l'ancien.
        UPDATE incoming_missions
          SET parc_exit_at = COALESCE(NEW.parked_at, now()), parc_exit_reason = 'reparc', updated_at = now()
          WHERE id = v_open_id;
        v_open_id := NULL;
      END IF;

      IF v_open_id IS NULL THEN
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
          v_root_id, NEW.id, 'GARD-' || COALESCE(v_root.external_id, left(v_root_id::text, 8)) || '-' || (v_n + 1),
          COALESCE(NEW.parked_at, now()), COALESCE(NEW.parked_at, now()), COALESCE(NEW.parked_at, now()),
          NEW.parc_zone_key, NEW.parc_row_number, NEW.parc_slot_index, NEW.park_stage_id, NEW.park_stage_name,
          NEW.depot_depart_id, NEW.key_location, NEW.keys_digibox_slot, NEW.saisie_key_hook, NEW.is_rollable, NEW.vehicle_location,
          NEW.vehicle_plate, NEW.vehicle_brand, NEW.vehicle_model, NEW.vehicle_vin, NEW.vehicle_vin_partial, NEW.vehicle_fuel, NEW.vehicle_gearbox, NEW.vehicle_class, NEW.vehicle_mileage,
          NEW.client_name, NEW.client_phone, NEW.client_address, NEW.assisted_name, NEW.assisted_phone,
          COALESCE(NEW.billed_to_id, v_root.billed_to_id), COALESCE(NEW.billed_to_name, v_root.billed_to_name),
          COALESCE(NEW.dossier_number, v_root.dossier_number), COALESCE(NEW.contract_label, v_root.contract_label),
          NEW.incident_address, NEW.incident_type, NEW.destination_address,
          NEW.redelivery_address, NEW.redelivery_lat, NEW.redelivery_lng, NEW.redelivery_info, NEW.garage_reopen_date,
          COALESCE(NEW.driver_photos, v_root.driver_photos), COALESCE(NEW.remarks_general, v_root.remarks_general),
          COALESCE(NEW.odoo_vehicle_id, v_root.odoo_vehicle_id), COALESCE(NEW.storage_waived, false), NEW.storage_flat_htva,
          1
        );
      ELSE
        -- Même fiche remise en parc sans être sortie (correction de statut) :
        -- on rafraîchit la zone, on ne crée pas de doublon.
        UPDATE incoming_missions SET
          parc_zone_key = NEW.parc_zone_key, parc_row_number = NEW.parc_row_number, parc_slot_index = NEW.parc_slot_index,
          key_location = NEW.key_location, updated_at = now()
          WHERE id = v_open_id;
      END IF;

    -- ── 2. Toujours au parc : la zone / les clés / la relivraison bougent ──
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
        -- Le client de facturation du gardiennage suit celui du REM tant qu'il
        -- n'a pas été modifié à la main sur la fiche gardiennage.
        billed_to_id   = CASE WHEN g.billed_to_id IS NOT DISTINCT FROM OLD.billed_to_id THEN NEW.billed_to_id ELSE g.billed_to_id END,
        billed_to_name = CASE WHEN g.billed_to_id IS NOT DISTINCT FROM OLD.billed_to_id THEN NEW.billed_to_name ELSE g.billed_to_name END,
        storage_waived = NEW.storage_waived, storage_flat_htva = NEW.storage_flat_htva,
        updated_at = now()
        WHERE g.parent_mission_id = v_root_id AND g.dossier_leg AND g.parc_exit_at IS NULL;
    END IF;

    -- ── 3. SORTIE du parc (la fiche quitte 'parked') ──────────────────────
    IF TG_OP = 'UPDATE' AND OLD.status = 'parked' AND NEW.status IS DISTINCT FROM 'parked' THEN
      -- « Terminée — relivraison déléguée à la REL » : le véhicule est encore
      -- au parc, c'est le chargement par la REL qui fermera le gardiennage.
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
          WHEN 'delivering'  THEN 'relivraison'
          WHEN 'cancelled'   THEN 'annulation'
          WHEN 'ignored'     THEN 'annulation'
          WHEN 'to_invoice'  THEN 'sortie'
          WHEN 'completed'   THEN 'sortie'
          ELSE 'correction' END;
        UPDATE incoming_missions
          SET parc_exit_at = v_exit_at, parc_exit_reason = v_reason, updated_at = now()
          WHERE parent_mission_id = v_root_id AND dossier_leg AND parc_exit_at IS NULL;
      END IF;
    END IF;

    -- ── 4. Une REL charge le véhicule : fin du gardiennage en cours ────────
    IF TG_OP = 'UPDATE' AND NEW.parent_mission_id IS NOT NULL
       AND NEW.loaded_at IS NOT NULL AND OLD.loaded_at IS NULL THEN
      UPDATE incoming_missions
        SET parc_exit_at = NEW.loaded_at, parc_exit_reason = 'relivraison', updated_at = now()
        WHERE parent_mission_id = v_root_id AND dossier_leg AND parc_exit_at IS NULL;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Jamais bloquer une mise en parc / une sortie à cause du miroir.
    RAISE WARNING '[dossier_gardiennage_sync] mission % : %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dossier_gardiennage_sync ON incoming_missions;
CREATE TRIGGER trg_dossier_gardiennage_sync
  AFTER INSERT OR UPDATE ON incoming_missions
  FOR EACH ROW EXECUTE FUNCTION dossier_gardiennage_sync();

NOTIFY pgrst, 'reload schema';
