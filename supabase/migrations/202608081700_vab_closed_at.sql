-- Horodatage de clôture d'une mission chez VAB Comet (via closeVabMission).
-- Olivier 2026-08-08.
alter table public.incoming_missions
  add column if not exists vab_closed_at timestamptz;
notify pgrst, 'reload schema';
