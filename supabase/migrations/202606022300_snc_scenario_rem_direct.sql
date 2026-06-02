-- Olivier 2026-06-02 : 4eme scenario SNC = rem_direct.
-- Specifique a Siabis Couvert (SC) : le chauffeur remorque directement le
-- vehicule chez le client sans passer par le depot Pepinster. Tarif = km
-- depot -> intervention -> destination -> depot, avec PEC unique (pas de
-- relivraison facturee separement, le forfait couvre).

ALTER TABLE public.incoming_missions
  DROP CONSTRAINT IF EXISTS incoming_missions_snc_scenario_check;

ALTER TABLE public.incoming_missions
  ADD CONSTRAINT incoming_missions_snc_scenario_check
  CHECK (snc_scenario IS NULL OR snc_scenario IN ('dsp', 'rem_client', 'rem_depot', 'rem_direct'));

COMMENT ON COLUMN public.incoming_missions.snc_scenario IS
  'Scenario SNC/SC : dsp = depannage sur place, rem_client = REM vers client (SNC), rem_direct = REM direct sans depot (SC), rem_depot = mise en parc Transit (relivraison ulterieure)';

NOTIFY pgrst, 'reload schema';
