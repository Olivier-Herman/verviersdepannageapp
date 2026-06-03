-- src/supabase/migrations/202606031000_police_pv_number.sql
--
-- Olivier 2026-06-03 : ajoute la colonne police_pv_number sur incoming_missions
-- pour le numero de proces-verbal de police, utilise en recherche dans /fourriere.
--
-- Format libre (texte) — pas de contrainte d unicite (plusieurs missions peuvent
-- partager un meme PV, ex : carambolage).

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS police_pv_number TEXT;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_police_pv_number
  ON public.incoming_missions (police_pv_number)
  WHERE police_pv_number IS NOT NULL;

COMMENT ON COLUMN public.incoming_missions.police_pv_number IS
  'Numero de PV police (texte libre, indexe pour recherche /fourriere).';

NOTIFY pgrst, 'reload schema';
