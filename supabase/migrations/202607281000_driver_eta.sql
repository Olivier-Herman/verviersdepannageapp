-- ETA live du chauffeur assigné vers le prochain point (incident ou destination),
-- calculé gratuitement via OpenRouteService à partir du GPS chauffeur (pings 30s).
-- Rempli par le cron /api/cron/driver-etas et affiché sur le dispatch.
-- Olivier 2026-07-28.
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS driver_eta_minutes integer,
  ADD COLUMN IF NOT EXISTS driver_eta_at      timestamptz;

NOTIFY pgrst, 'reload schema';
