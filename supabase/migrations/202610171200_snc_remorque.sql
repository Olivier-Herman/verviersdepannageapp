-- Siabis (couvert et non couvert) : véhicule avec remorque → majoration 50 % sur la prise en charge et les km
-- dépanneuse (Olivier 17/10/2026, fiche 10193462).
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS snc_remorque BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.incoming_missions.snc_remorque IS
  'Siabis : véhicule avec remorque → ligne « Majoration remorque 50 % » sur prise en charge + km dépanneuse.';

notify pgrst, 'reload schema';
