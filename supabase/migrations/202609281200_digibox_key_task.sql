-- ============================================================
-- 202609281200_digibox_key_task
-- ============================================================
-- Olivier 28/09/2026 : « lorsqu'une clé est mise en digibox, il faudra créer
-- une tâche pour le bureau fourrière pour récupérer la clé et la transférer
-- en crochet ou bureau ou dans le véhicule ».
--
-- Déclenché par l'ÉVÉNEMENT (la clé PASSE en digibox), pas par l'état : 36
-- fiches anciennes portent encore une clé « en digibox » jamais mise à jour.
-- Le déclencheur vit en base pour couvrir tous les chemins d'écriture (app
-- chauffeur, fiche dispatch, fourrière, prise en charge, clôture).
--   • la clé entre en digibox  → tâche 'digibox_key' à faire (rouverte si besoin) ;
--   • la clé sort de digibox   → tâche faite, quel que soit l'écran qui l'a sortie.
-- ============================================================

CREATE OR REPLACE FUNCTION public.digibox_key_task() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key_location LIKE 'digibox%' AND (TG_OP = 'INSERT' OR OLD.key_location IS DISTINCT FROM NEW.key_location) THEN
    INSERT INTO public.process_runs (mission_id, process_key, status, answers, started_at, updated_at, completed_at)
    VALUES (NEW.id, 'digibox_key', 'todo', jsonb_build_object('from', NEW.key_location), now(), now(), NULL)
    ON CONFLICT (mission_id, process_key) DO UPDATE
      SET status = 'todo', answers = jsonb_build_object('from', NEW.key_location), started_at = now(), updated_at = now(), completed_at = NULL;
  ELSIF TG_OP = 'UPDATE' AND OLD.key_location LIKE 'digibox%' AND (NEW.key_location IS NULL OR NEW.key_location NOT LIKE 'digibox%') THEN
    UPDATE public.process_runs
       SET status = 'done', completed_at = now(), updated_at = now(),
           answers = answers || jsonb_build_object('to', NEW.key_location, 'hook', NEW.saisie_key_hook)
     WHERE mission_id = NEW.id AND process_key = 'digibox_key' AND status <> 'done';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_digibox_key_task ON public.incoming_missions;
CREATE TRIGGER trg_digibox_key_task
  AFTER INSERT OR UPDATE OF key_location ON public.incoming_missions
  FOR EACH ROW EXECUTE FUNCTION public.digibox_key_task();

NOTIFY pgrst, 'reload schema';
