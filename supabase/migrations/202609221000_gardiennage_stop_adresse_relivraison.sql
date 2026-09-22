-- supabase/migrations/202609221000_gardiennage_stop_adresse_relivraison.sql
--
-- Olivier 22/09/2026 (HSNA990) : « une fois qu'une adresse de relivraison
-- différente du dépôt est connue, on ne compte plus de gardiennage. Si nous
-- prenons deux semaines à délivrer, il n'y a pas de raison que ce soit le
-- client qui paie. » Toutes les sources.
--   • le gardiennage s'arrête au moment où l'adresse de relivraison RÉELLE est
--     posée sur la fiche en parc (volet fermé, motif adresse_relivraison) ;
--   • redelivery_known_at garde ce moment sur la racine (écran Parc, audits) ;
--   • si l'adresse est retirée (ou remplacée par un dépôt) alors que le véhicule
--     est toujours au parc, un nouveau volet s'ouvre : le gardiennage reprend ;
--   • un véhicule mis en parc avec l'adresse réelle déjà connue : le volet
--     s'ouvre puis se ferme aussitôt (aucune nuit à charge).

ALTER TABLE incoming_missions ADD COLUMN IF NOT EXISTS redelivery_known_at timestamptz NULL;
COMMENT ON COLUMN incoming_missions.redelivery_known_at IS 'Moment où l''adresse de relivraison réelle (≠ dépôt) a été posée : le gardiennage s''arrête là (Olivier 22/09/2026)';

-- Adresse d'un de NOS dépôts (ou vide) → pas une vraie destination.
CREATE OR REPLACE FUNCTION dossier_is_depot_address(p_addr text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_a text;
  v_d record;
  v_street text;
BEGIN
  v_a := lower(translate(COALESCE(p_addr, ''), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'));
  v_a := regexp_replace(v_a, '[^a-z0-9]+', ' ', 'g');
  v_a := btrim(v_a);
  IF v_a = '' THEN RETURN true; END IF;
  IF v_a LIKE '%verviers depannage%' OR v_a LIKE '%lefin 12%' OR v_a LIKE '%rue lefin%' THEN RETURN true; END IF;
  FOR v_d IN SELECT address FROM depots WHERE COALESCE(active, true) LOOP
    v_street := lower(translate(COALESCE(v_d.address, ''), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'));
    v_street := btrim(regexp_replace(v_street, '[^a-z0-9]+', ' ', 'g'));
    -- rue + numéro (avant la virgule d'origine ≈ 3 à 4 premiers mots), au moins 8 caractères
    v_street := btrim(regexp_replace(v_street, '^((\S+\s+){1,3}\S+).*$', '\1'));
    IF length(v_street) >= 8 AND (v_a LIKE '%' || v_street || '%' OR v_street LIKE '%' || v_a || '%') THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- BEFORE UPDATE : l'adresse réelle apparaît → volet fermé ; elle disparaît → volet rouvert.
CREATE OR REPLACE FUNCTION dossier_gardiennage_redelivery_stop() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old_real boolean;
  v_new_real boolean;
  v_open uuid;
BEGIN
  BEGIN
    IF TG_OP <> 'UPDATE' OR NEW.dossier_leg THEN RETURN NEW; END IF;
    IF NEW.redelivery_address IS NOT DISTINCT FROM OLD.redelivery_address THEN RETURN NEW; END IF;
    v_old_real := NOT dossier_is_depot_address(OLD.redelivery_address);
    v_new_real := NOT dossier_is_depot_address(NEW.redelivery_address);
    IF v_new_real AND NOT v_old_real THEN
      NEW.redelivery_known_at := now();
      IF NEW.status = 'parked' THEN
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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[dossier_gardiennage_redelivery_stop] mission % : %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_dossier_gardiennage_redelivery_stop ON incoming_missions;
CREATE TRIGGER trg_dossier_gardiennage_redelivery_stop
  BEFORE UPDATE OF redelivery_address ON incoming_missions
  FOR EACH ROW EXECUTE FUNCTION dossier_gardiennage_redelivery_stop();

-- AFTER UPDATE OF status : mise en parc avec l'adresse réelle déjà connue → le
-- volet ouvert par trg_dossier_gardiennage_sync se ferme aussitôt. Nommé « zz »
-- pour passer APRÈS le sync (ordre alphabétique des déclencheurs).
CREATE OR REPLACE FUNCTION dossier_gardiennage_redelivery_park() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF TG_OP <> 'UPDATE' OR NEW.dossier_leg THEN RETURN NEW; END IF;
    IF NEW.status <> 'parked' OR OLD.status IS NOT DISTINCT FROM 'parked' THEN RETURN NEW; END IF;
    IF dossier_is_depot_address(NEW.redelivery_address) THEN RETURN NEW; END IF;
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
DROP TRIGGER IF EXISTS trg_dossier_gardiennage_zz_redelivery_park ON incoming_missions;
CREATE TRIGGER trg_dossier_gardiennage_zz_redelivery_park
  AFTER UPDATE OF status ON incoming_missions
  FOR EACH ROW EXECUTE FUNCTION dossier_gardiennage_redelivery_park();

NOTIFY pgrst, 'reload schema';
