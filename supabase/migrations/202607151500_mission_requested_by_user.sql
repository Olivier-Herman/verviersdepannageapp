-- Trace le user (garage) qui a créé la demande, pour afficher « Commandé par »
-- côté espace garage (une même entité peut avoir plusieurs utilisateurs).
-- Olivier 2026-07-15.
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid REFERENCES public.users(id);

NOTIFY pgrst, 'reload schema';
