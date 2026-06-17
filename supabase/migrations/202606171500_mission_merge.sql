-- supabase/migrations/202606171500_mission_merge.sql
--
-- Olivier 2026-06-17 : fusion de fiches en double (ex. fiche chauffeur police
-- accident + fiche assistance reçue par mail pour la même intervention).
--
-- La fiche secondaire est soft-cancel et pointe vers la fiche principale
-- conservée via merged_into_mission_id (traçabilité + lien cliquable).

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS merged_into_mission_id UUID;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_merged_into
  ON public.incoming_missions (merged_into_mission_id)
  WHERE merged_into_mission_id IS NOT NULL;

COMMENT ON COLUMN public.incoming_missions.merged_into_mission_id IS
  'Si renseigné : cette fiche a été fusionnée (soft-cancel) dans la fiche pointée. '
  'La fiche principale conserve photos/travail/parc ; la secondaire apporte le payeur/dossier assistance.';

NOTIFY pgrst, 'reload schema';
