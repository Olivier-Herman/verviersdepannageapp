-- supabase/migrations/202606180900_key_location.sql
--
-- Olivier 2026-06-18 : localisation de la clé d'un véhicule mis en parc.
--
--   key_location : où se trouve la clé (choisi par le chauffeur à la mise en parc)
--     - in_vehicle        : dans le véhicule
--     - bureau_rac        : bureau Rent A Car
--     - digibox_rac       : digibox Rent A Car
--     - digibox_depannage : digibox Dépannage
--
--   saisie_key_hook : pour les SAISIES, n° du crochet de la boîte à clés du
--     bureau (saisi côté office sur la fiche dispatch).

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS key_location    TEXT,
  ADD COLUMN IF NOT EXISTS saisie_key_hook TEXT;

NOTIFY pgrst, 'reload schema';
