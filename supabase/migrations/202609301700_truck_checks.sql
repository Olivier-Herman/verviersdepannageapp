-- Check camion par le chauffeur (Olivier 30/09/2026, maquette validée
-- https://claude.ai/artifact/WHWzq8AJt5hqdSJDZhWQBi) : camion + kilométrage,
-- anomalies illimitées (titre, description, niveau, photos), commentaire général
-- facultatif. À l'envoi : mail info@ + administration@, fenêtre au bureau.
-- Aucun camion n'est bloqué, quel que soit le niveau.
CREATE TABLE IF NOT EXISTS public.truck_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id      uuid REFERENCES public.trucks(id) ON DELETE SET NULL,
  truck_plate   text NOT NULL,
  truck_name    text,
  mileage       integer NOT NULL,
  comment       text,
  driver_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  driver_name   text,
  anomaly_count integer NOT NULL DEFAULT 0,
  max_level     integer NOT NULL DEFAULT 0,     -- 0 = rien à signaler ; 1 remarque … 5 dangereux
  mail_sent_at  timestamptz,
  mail_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_truck_checks_truck ON public.truck_checks (truck_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_truck_checks_created ON public.truck_checks (created_at DESC);

CREATE TABLE IF NOT EXISTS public.truck_check_anomalies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id     uuid NOT NULL REFERENCES public.truck_checks(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  level        integer NOT NULL CHECK (level BETWEEN 1 AND 5),  -- 1 remarque, 2 à surveiller, 3 à réparer, 4 urgent, 5 dangereux
  photos       text[] NOT NULL DEFAULT '{}',                    -- chemins dans le bucket check-photos
  sort         integer NOT NULL DEFAULT 0,
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_truck_check_anomalies_check ON public.truck_check_anomalies (check_id, sort);

-- Qui a vu le rapport au bureau (la fenêtre ne se rouvre plus pour lui).
CREATE TABLE IF NOT EXISTS public.truck_check_views (
  check_id  uuid NOT NULL REFERENCES public.truck_checks(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (check_id, user_id)
);

ALTER TABLE public.truck_checks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.truck_check_anomalies DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.truck_check_views DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.truck_checks TO service_role;
GRANT ALL ON public.truck_check_anomalies TO service_role;
GRANT ALL ON public.truck_check_views TO service_role;

notify pgrst, 'reload schema';
