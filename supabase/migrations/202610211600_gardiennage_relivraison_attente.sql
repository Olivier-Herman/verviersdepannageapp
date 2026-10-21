-- Gardiennage et adresse de relivraison : deux exceptions (Olivier 21/10/2026, Porsche HB224LG #10192345).
-- Règle du 22/09 : dès que l'adresse RÉELLE de relivraison est connue, le gardiennage s'arrête (si nous
-- mettons deux semaines à relivrer, ce n'est pas au client de payer). Mais :
--   1. « On a reçu l'adresse de relivraison mais on nous a demandé d'attendre avant de la reconduire » :
--      le gardiennage CONTINUE → case « relivraison en attente » (redelivery_wait) sur la fiche ;
--   2. « Si nous ne faisons pas la relivraison et que quelqu'un vient rechercher le véhicule, il faudra
--      compter le gardiennage » → à la sortie du parc sans relivraison de notre part, le volet fermé
--      par l'adresse est prolongé jusqu'à la sortie réelle.

ALTER TABLE incoming_missions ADD COLUMN IF NOT EXISTS redelivery_wait boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN incoming_missions.redelivery_wait IS 'Relivraison en attente à la demande (assistance, client) : l''adresse connue n''arrête pas le gardiennage (Olivier 21/10/2026)';

-- 1. Adresse posée / retirée, ou case « en attente » cochée / décochée.
CREATE OR REPLACE FUNCTION dossier_gardiennage_redelivery_stop() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old_real boolean;
  v_new_real boolean;
  v_open uuid;
BEGIN
  BEGIN
    IF TG_OP <> 'UPDATE' OR NEW.dossier_leg THEN RETURN NEW; END IF;
    v_old_real := NOT dossier_is_depot_address(OLD.redelivery_address);
    v_new_real := NOT dossier_is_depot_address(NEW.redelivery_address);

    -- a) la case « relivraison en attente » change
    IF NEW.redelivery_wait IS DISTINCT FROM OLD.redelivery_wait AND NEW.status = 'parked' THEN
      IF NEW.redelivery_wait THEN
        -- en attente : le volet fermé par l'adresse se rouvre (le gardiennage reprend depuis l'entrée)
        UPDATE incoming_missions SET parc_exit_at = NULL, parc_exit_reason = NULL, updated_at = now()
          WHERE dossier_leg AND parc_exit_reason = 'adresse_relivraison'
            AND (parent_mission_id = NEW.id OR parc_origin_mission_id = NEW.id);
      ELSIF v_new_real THEN
        -- plus en attente, adresse réelle connue : le gardiennage s'arrête maintenant
        NEW.redelivery_known_at := COALESCE(NEW.redelivery_known_at, now());
        UPDATE incoming_missions SET parc_exit_at = now(), parc_exit_reason = 'adresse_relivraison', updated_at = now()
          WHERE dossier_leg AND parc_exit_at IS NULL
            AND (parent_mission_id = NEW.id OR parc_origin_mission_id = NEW.id);
      END IF;
    END IF;

    -- b) l'adresse change (règle du 22/09, sauf relivraison en attente)
    IF NEW.redelivery_address IS DISTINCT FROM OLD.redelivery_address THEN
      IF v_new_real AND NOT v_old_real THEN
        NEW.redelivery_known_at := now();
        IF NEW.status = 'parked' AND NOT NEW.redelivery_wait THEN
          UPDATE incoming_missions
            SET parc_exit_at = now(), parc_exit_reason = 'adresse_relivraison', updated_at = now()
            WHERE dossier_leg AND parc_exit_at IS NULL
              AND (parent_mission_id = NEW.id OR parc_origin_mission_id = NEW.id);
        END IF;
      ELSIF v_old_real AND NOT v_new_real THEN
        NEW.redelivery_known_at := NULL;
        IF NEW.status = 'parked' THEN
          SELECT id INTO v_open FROM incoming_missions
            WHERE dossier_leg AND parc_exit_at IS NULL AND (parent_mission_id = NEW.id OR parc_origin_mission_id = NEW.id) LIMIT 1;
          IF v_open IS NULL THEN
            PERFORM dossier_gardiennage_open(NEW.id, now());
          END IF;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[dossier_gardiennage_redelivery_stop] mission % : %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dossier_gardiennage_redelivery_stop ON incoming_missions;
CREATE TRIGGER trg_dossier_gardiennage_redelivery_stop
  BEFORE UPDATE OF redelivery_address, redelivery_wait ON incoming_missions
  FOR EACH ROW EXECUTE FUNCTION dossier_gardiennage_redelivery_stop();

-- Mise en parc avec l'adresse réelle déjà connue : volet fermé aussitôt, sauf relivraison en attente.
CREATE OR REPLACE FUNCTION dossier_gardiennage_redelivery_park() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF TG_OP <> 'UPDATE' OR NEW.dossier_leg THEN RETURN NEW; END IF;
    IF NEW.status <> 'parked' OR OLD.status IS NOT DISTINCT FROM 'parked' THEN RETURN NEW; END IF;
    IF dossier_is_depot_address(NEW.redelivery_address) OR NEW.redelivery_wait THEN RETURN NEW; END IF;
    UPDATE incoming_missions SET redelivery_known_at = COALESCE(redelivery_known_at, now()) WHERE id = NEW.id AND redelivery_known_at IS NULL;
    UPDATE incoming_missions
      SET parc_exit_at = COALESCE(NEW.parked_at, now()), parc_exit_reason = 'adresse_relivraison', updated_at = now()
      WHERE dossier_leg AND parc_exit_at IS NULL
        AND (parent_mission_id = NEW.id OR parc_origin_mission_id = NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[dossier_gardiennage_redelivery_park] mission % : %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- 2. Sortie du parc SANS relivraison de notre part (restitution, enlèvement, sortie…) alors qu'aucune
--    relivraison n'est en attente : le volet fermé par l'adresse est prolongé jusqu'à la sortie réelle.
--    Notre relivraison passe par « delivering » (chargement) : elle n'est pas concernée.
CREATE OR REPLACE FUNCTION dossier_gardiennage_exit_sans_rel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_rel_pending boolean;
  v_n int;
BEGIN
  BEGIN
    IF TG_OP <> 'UPDATE' OR NEW.dossier_leg OR NEW.source = 'gardiennage' THEN RETURN NEW; END IF;
    IF OLD.status IS DISTINCT FROM 'parked' OR NEW.status NOT IN ('to_invoice', 'completed') THEN RETURN NEW; END IF;
    SELECT EXISTS (
      SELECT 1 FROM incoming_missions c
      WHERE c.parent_mission_id = NEW.id AND NOT c.dossier_leg AND c.source <> 'gardiennage'
        AND c.loaded_at IS NULL AND c.status NOT IN ('cancelled', 'ignored', 'completed', 'to_invoice')
    ) INTO v_rel_pending;
    IF v_rel_pending THEN RETURN NEW; END IF;
    UPDATE incoming_missions
      SET parc_exit_at = now(), parc_exit_reason = 'sortie', updated_at = now()
      WHERE dossier_leg AND parc_exit_reason = 'adresse_relivraison' AND no_charge_at IS NULL
        AND (parent_mission_id = NEW.id OR parc_origin_mission_id = NEW.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      INSERT INTO mission_logs (mission_id, action, notes)
      VALUES (NEW.id, 'gardiennage_prolonge', 'Sortie du parc sans relivraison de notre part : le gardiennage arrêté à l''adresse de relivraison est compté jusqu''à la sortie réelle (règle d''Olivier du 21/10/2026).');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[dossier_gardiennage_exit_sans_rel] mission % : %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zzz_dossier_gardiennage_exit_sans_rel ON incoming_missions;
CREATE TRIGGER zzz_dossier_gardiennage_exit_sans_rel
  AFTER UPDATE OF status ON incoming_missions
  FOR EACH ROW EXECUTE FUNCTION dossier_gardiennage_exit_sans_rel();

notify pgrst, 'reload schema';
