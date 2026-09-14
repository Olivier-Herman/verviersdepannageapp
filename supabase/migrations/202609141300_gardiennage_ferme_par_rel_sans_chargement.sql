-- 202609141300 — Le gardiennage se ferme quand la relivraison PART, même sans
-- « véhicule chargé » (Olivier 14/09/2026 : « comment un véhicule peut avoir un
-- gardiennage en cours alors que la REL est terminée ? »).
--
-- Le trigger dossier_gardiennage_sync (202609071300, section 4) ne ferme le
-- gardiennage que sur `loaded_at` de la REL. 2HJJ039, 2JEM405, 1KRB589 : le
-- chauffeur est parti (on_way) et a livré sans pointer le chargement → le
-- gardiennage courait encore, « Gardiennage en cours » à côté d'une REL
-- terminée. Ici : dès que la REL passe en route / en livraison / terminée /
-- à facturer, le gardiennage encore ouvert du dossier est fermé à la date la
-- plus fiable (chargement, sinon départ, sinon fin, sinon maintenant).
-- Les gardiennages pendent toujours sur la RACINE du dossier : on remonte les
-- parents (une REL peut avoir une REL pour parent, cf 1UAU876).

CREATE OR REPLACE FUNCTION dossier_gardiennage_rel_exit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_root_id uuid;
  v_parent  uuid;
  v_hops    int := 0;
  v_exit_at timestamptz;
BEGIN
  BEGIN
    IF TG_OP <> 'UPDATE' OR NEW.dossier_leg OR NEW.parent_mission_id IS NULL THEN RETURN NEW; END IF;
    IF lower(COALESCE(NEW.mission_type, '')) NOT LIKE '%rel%' THEN RETURN NEW; END IF;
    IF NEW.status NOT IN ('delivering', 'completed', 'to_invoice') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

    -- Racine du dossier : on remonte les parents (3 niveaux max).
    v_root_id := NEW.parent_mission_id;
    LOOP
      SELECT parent_mission_id INTO v_parent FROM incoming_missions WHERE id = v_root_id;
      EXIT WHEN v_parent IS NULL OR v_hops >= 3;
      v_root_id := v_parent; v_hops := v_hops + 1;
    END LOOP;

    v_exit_at := COALESCE(NEW.loaded_at, NEW.on_way_at, NEW.completed_at, now());
    UPDATE incoming_missions
      SET parc_exit_at = v_exit_at, parc_exit_reason = 'relivraison', updated_at = now()
      WHERE parent_mission_id = v_root_id AND dossier_leg AND parc_exit_at IS NULL
        AND (parked_at IS NULL OR parked_at <= v_exit_at);

    -- La fiche principale ne reste pas « au parc » une fois la REL livrée
    -- (2JPR337, 14/09/2026 : A « Au parc », C terminée) : elle passe à facturer.
    IF NEW.status IN ('completed', 'to_invoice') THEN
      UPDATE incoming_missions
        SET status = 'to_invoice', completed_at = COALESCE(completed_at, NEW.completed_at, now()), updated_at = now()
        WHERE id = v_root_id AND status = 'parked';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[dossier_gardiennage_rel_exit] mission % : %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dossier_gardiennage_rel_exit ON incoming_missions;
CREATE TRIGGER trg_dossier_gardiennage_rel_exit
  AFTER UPDATE OF status ON incoming_missions
  FOR EACH ROW EXECUTE FUNCTION dossier_gardiennage_rel_exit();

NOTIFY pgrst, 'reload schema';
