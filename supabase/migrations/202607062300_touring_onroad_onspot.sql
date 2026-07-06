-- Horodatage des poussées de statut Touring COMEX (en route / sur place), pour
-- l'idempotence (ne pas re-pousser) et l'auto-gestion SLA du cron.
--   touring_onroad_at  = quand VD Soft a poussé onRoad (05) dans COMEX
--   touring_onspot_at  = quand VD Soft a poussé onSpot (06) dans COMEX
-- Base = touring_accepted_at (migration précédente). Olivier 2026-07-06.
alter table public.incoming_missions
  add column if not exists touring_onroad_at timestamptz,
  add column if not exists touring_onspot_at timestamptz;

notify pgrst, 'reload schema';
