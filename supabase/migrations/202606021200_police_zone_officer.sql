-- Olivier 2026-06-02 : sauvegarde la zone de police + nom de policier dans
-- incoming_missions pour l affichage sur l etiquette parc (Police Saisie).
-- Auparavant ces champs etaient uniquement dans towsoft_queue.

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS police_zone   text,
  ADD COLUMN IF NOT EXISTS officer_name  text;

COMMENT ON COLUMN public.incoming_missions.police_zone IS
  'Zone de police qui a requisitionne le service (ex: Police Zone Fagnes).
   Affiche sur l etiquette parc pour Police Saisie.';
COMMENT ON COLUMN public.incoming_missions.officer_name IS
  'Nom du policier responsable de la requisition (optionnel). Affiche sur
   l etiquette parc pour Police Saisie a la suite de police_zone.';

NOTIFY pgrst, 'reload schema';
