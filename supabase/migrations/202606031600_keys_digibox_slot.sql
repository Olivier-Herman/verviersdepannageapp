-- src/supabase/migrations/202606031600_keys_digibox_slot.sql
--
-- Olivier 2026-06-03 : ajoute keys_digibox_slot sur incoming_missions.
-- C est le numero de crochet dans le digibox ou se trouve les cles du
-- vehicule en parc. Recupere depuis le champ "Emplacement - Rangee" de
-- la fiche TowSoft.

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS keys_digibox_slot TEXT;

COMMENT ON COLUMN public.incoming_missions.keys_digibox_slot IS
  'N° crochet digibox ou se trouvent les cles du vehicule. Source : champ "Emplacement - Rangee" de TowSoft.';

NOTIFY pgrst, 'reload schema';
