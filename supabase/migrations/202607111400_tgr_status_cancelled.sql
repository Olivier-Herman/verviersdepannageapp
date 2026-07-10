-- Autoriser le statut 'cancelled' sur tgr_missions (annulation des missions test
-- depuis /admin/tgr). La table a été créée hors migrations → on retire une
-- éventuelle contrainte CHECK sur `status` (nom inconnu) et on la recrée avec
-- 'cancelled'. Olivier 2026-07-11.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'public.tgr_missions'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tgr_missions DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.tgr_missions
  ADD CONSTRAINT tgr_missions_status_check
  CHECK (status IN ('pending', 'accepted', 'refused', 'taken', 'completed', 'cancelled'));

NOTIFY pgrst, 'reload schema';
