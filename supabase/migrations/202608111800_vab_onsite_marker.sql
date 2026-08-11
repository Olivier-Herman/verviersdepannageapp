-- Marqueur « mission VAB amenée à l'écran de code » (flux 2, Olivier 2026-08-11).
-- Distinct de vab_closed_at (clôture VAB terminée) : la brique on-site s'arrête à
-- l'écran de code, la validation des codes viendra ensuite (reprise HTTP).
alter table public.incoming_missions
  add column if not exists vab_onsite_at timestamptz;

comment on column public.incoming_missions.vab_onsite_at is
  'Horodatage du passage on-site → écran de code chez VAB (pilotage headless, flux 2)';

notify pgrst, 'reload schema';
