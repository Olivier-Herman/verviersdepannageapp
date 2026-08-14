-- Correctif du trigger de log création : dispatch_mode='manual' PAR DÉFAUT partout
-- (même les imports auto) → n'est PAS un marqueur fiable de création manuelle.
-- Le vrai marqueur = parsed_data.created_manually_by (posé par create/route.ts).
-- Olivier 2026-08-14.

CREATE OR REPLACE FUNCTION log_mission_creation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  should_log boolean := false;
BEGIN
  -- On loggue seulement les créations AUTO (les manuelles ont déjà leur log
  -- détaillé « Mission créée manuellement par X »).
  IF (NEW.parsed_data->>'created_manually_by') IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      should_log := COALESCE(NEW.source, 'unknown') <> 'unknown';
    ELSIF TG_OP = 'UPDATE' THEN
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
