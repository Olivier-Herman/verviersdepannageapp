-- Fix module Francofolies (enlèvement) : la route pickup écrit client_city et
-- client_vat sur incoming_missions, et l'export les relit — or ces colonnes
-- n'avaient jamais été créées (la migration 202606291500 n'ajoutait que les
-- ff_*). Résultat : « Could not find the 'client_city' column ... in the schema
-- cache » → l'update échouait et la fiche restait 'parked'.
-- IF NOT EXISTS : no-op si déjà présentes. Olivier 2026-07-17.
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS client_city text,
  ADD COLUMN IF NOT EXISTS client_vat  text;

-- Indispensable : sans reload, PostgREST garde l'ancien cache de schéma et
-- continue de rejeter l'écriture même après l'ALTER.
NOTIFY pgrst, 'reload schema';
