-- Relivraison refusée par le garage + sortie par notre propre relivraison (Olivier 28/10/2026, 2CSA107 #10212602).
--
-- 1. dossier_gardiennage_rel_exit : une relivraison clôturée avec un motif de refus (garage refusé / fermé, dpr_motif)
--    n'a PAS sorti le véhicule du parc : le dossier principal reste « au parc » (avant : il passait « à facturer »).
-- 2. dossier_gardiennage_exit_sans_rel : la prolongation « sortie sans relivraison de notre part » (21/10/2026) se
--    déclenchait aussi quand c'est NOTRE relivraison qui a livré (1VTN786, 1XSH143) : le test ne regardait que les
--    relivraisons pas encore chargées. Désormais, une relivraison/remorquage du dossier chargée ou terminée par nous
--    (sans refus) = sortie par nous → pas de prolongation.

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
    -- Livraison refusée (garage refusé / fermé) : le véhicule revient au parc, rien ne change sur le dossier.
    IF NEW.status IN ('completed', 'to_invoice') AND NEW.dpr_motif IS NOT NULL THEN RETURN NEW; END IF;

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

    -- La fiche principale ne reste pas « au parc » une fois la REL livrée (2JPR337, 14/09/2026) : elle passe à facturer.
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

CREATE OR REPLACE FUNCTION dossier_gardiennage_exit_sans_rel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_rel_pending boolean;
  v_par_nous    boolean;
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
    -- Sortie faite par NOUS (relivraison ou remorquage du dossier, chargé ou terminé, sans refus) : pas de prolongation.
    SELECT EXISTS (
      SELECT 1 FROM incoming_missions c
      WHERE c.parent_mission_id = NEW.id AND NOT c.dossier_leg AND c.source <> 'gardiennage'
        AND c.dpr_motif IS NULL
        AND (c.loaded_at IS NOT NULL OR c.status IN ('delivering', 'completed', 'to_invoice'))
    ) INTO v_par_nous;
    IF v_par_nous THEN RETURN NEW; END IF;
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

notify pgrst, 'reload schema';
