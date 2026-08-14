-- Log de création uniforme dans l'historique de CHAQUE fiche (Olivier 2026-08-14).
-- Trigger DB → couvre tous les points d'entrée sans toucher au code d'import.
--   • Imports auto à insertion directe (VAB, AXA, Kaze, Touring, domaine…) :
--     loggés à l'INSERT.
--   • Placeholder mail (source 'unknown' à l'insert, réelle à la finalisation) :
--     loggé à l'UPDATE quand la source passe de unknown → réelle.
--   • Créations MANUELLES : ignorées ici (elles ont déjà leur propre log détaillé
--     « Mission créée manuellement par X », dispatch_mode='manual').

CREATE OR REPLACE FUNCTION log_mission_creation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  should_log boolean := false;
BEGIN
  IF NEW.dispatch_mode IS DISTINCT FROM 'manual' THEN
    IF TG_OP = 'INSERT' THEN
      should_log := COALESCE(NEW.source, 'unknown') <> 'unknown';
    ELSIF TG_OP = 'UPDATE' THEN
      -- placeholder mail finalisé : la source devient réelle
      should_log := COALESCE(OLD.source, 'unknown') = 'unknown'
                AND COALESCE(NEW.source, 'unknown') <> 'unknown';
    END IF;
  END IF;

  IF should_log THEN
    INSERT INTO mission_logs (mission_id, actor_id, action, notes, metadata)
    VALUES (
      NEW.id, NULL, 'received',
      'Fiche créée automatiquement — ' || NEW.source,
      jsonb_build_object('source', NEW.source, 'source_format', NEW.source_format, 'auto', true)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_mission_creation ON incoming_missions;
CREATE TRIGGER trg_log_mission_creation
  AFTER INSERT OR UPDATE OF source ON incoming_missions
  FOR EACH ROW EXECUTE FUNCTION log_mission_creation();
