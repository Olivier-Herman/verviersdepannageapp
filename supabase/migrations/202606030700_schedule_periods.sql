-- Olivier 2026-06-03 : table pour configurer les periodes de garde depuis
-- /admin/garde-schedule. Avant : hardcoded dans lib/schedule.ts (jour 7-20,
-- nuit 17-9, autodispatch_nuit 18-8).
-- Maintenant : modifiable par admin sans deploiement.

CREATE TABLE IF NOT EXISTS public.schedule_periods (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('day', 'night', 'autodispatch_night')),
  -- Heures decimales locales Belgique : 7.0 = 7h00, 20.5 = 20h30, 24.0 = minuit fin.
  hour_start    NUMERIC(4,2) NOT NULL CHECK (hour_start >= 0 AND hour_start <= 24),
  hour_end      NUMERIC(4,2) NOT NULL CHECK (hour_end >= 0 AND hour_end <= 24),
  -- Si true, la plage est cross-midnight (ex: 17h-9h = 17h-24h + 0h-9h).
  cross_midnight BOOLEAN NOT NULL DEFAULT false,
  label         TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.schedule_periods DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.schedule_periods TO authenticated, anon, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.schedule_periods_id_seq TO authenticated, anon, service_role;

-- Seed avec les valeurs actuelles hardcoded
INSERT INTO public.schedule_periods (kind, hour_start, hour_end, cross_midnight, label)
VALUES
  ('day',                  7.0, 20.0, false, 'Plage de jour (driver schedule_day)'),
  ('night',                17.0, 9.0, true, 'Plage de nuit (driver schedule_night)'),
  ('autodispatch_night',   18.0, 8.0, true, 'Plage auto-dispatch nuit (priorite stricte)')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.schedule_periods IS
  'Periodes de garde configurables. Heures locales Belgique (Europe/Brussels). Lu par lib/schedule.ts avec cache 60s.';

NOTIFY pgrst, 'reload schema';
