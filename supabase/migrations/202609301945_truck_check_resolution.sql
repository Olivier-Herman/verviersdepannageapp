-- Suivi des anomalies de check camion au bureau (Olivier 30/09/2026) : ce qui a été
-- fait pour corriger, et quand le chauffeur qui l'avait signalé a été prévenu.
ALTER TABLE public.truck_check_anomalies
  ADD COLUMN IF NOT EXISTS resolution_note    text,
  ADD COLUMN IF NOT EXISTS driver_notified_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_truck_check_anomalies_open ON public.truck_check_anomalies (level) WHERE resolved_at IS NULL;

notify pgrst, 'reload schema';
