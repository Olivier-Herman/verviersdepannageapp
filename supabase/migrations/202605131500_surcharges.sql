-- ============================================================
-- Regles de majoration tarif (matrice client × jour × plages horaires)
-- ============================================================
-- Permet de stocker les majorations applicables par compagnie d'assistance
-- (Touring, Allianz, VAB, AXA, Ethias...) et pour les missions hors
-- assistance (SNC = sans compagnie / Accident Police).
--
-- Detection en facturation :
--   1. mission.source matche un client_key actif → grille de ce client
--   2. sinon mission.is_police_call = true → 'accident_police'
--   3. sinon → 'snc'
--
-- La colonne is_police_call est cochee par le dispatcher dans la fiche
-- mission (cas Police zone Vesdre / Police fagnes / etc). Evite les faux
-- positifs sur un client civil nomme "Police" (ex: Benoit Police).
--
-- Jours feries BE : le dimanche (weekday=7) couvre les feries (algo Paques
-- + dates fixes calcule cote serveur, pas de table a maintenir).

-- 1) Catalogue des clients ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.surcharge_clients (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('assistance','hors_assistance')),
  sort_order  smallint DEFAULT 0,
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- 2) Plages horaires (0..N par cellule) -------------------------------------

CREATE TABLE IF NOT EXISTS public.surcharge_schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key   text NOT NULL REFERENCES public.surcharge_clients(key) ON DELETE CASCADE,
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  hour_start   smallint NOT NULL CHECK (hour_start BETWEEN 0 AND 23),
  hour_end     smallint NOT NULL CHECK (hour_end BETWEEN 1 AND 24),
  rate_dsp_pct numeric(5,2),
  rate_rem_pct numeric(5,2),
  created_at   timestamptz DEFAULT now(),
  CHECK (hour_end > hour_start),
  CHECK (rate_dsp_pct IS NOT NULL OR rate_rem_pct IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_surcharge_schedules_lookup
  ON public.surcharge_schedules(client_key, weekday);

-- 3) GRANT service_role -----------------------------------------------------
GRANT ALL ON public.surcharge_clients   TO service_role;
GRANT ALL ON public.surcharge_schedules TO service_role;

-- 4) Colonne is_police_call sur missions ------------------------------------
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS is_police_call boolean DEFAULT false;

COMMENT ON COLUMN public.incoming_missions.is_police_call IS
  'Coche par le dispatcher pour les depannages hors assistance suite a un appel police (Police zone Vesdre, Police fagnes...). Determine la grille de majoration appliquee en facturation.';

-- 5) Seed initial : SNC + Accident Police (toujours presents) ---------------

INSERT INTO public.surcharge_clients (key, label, kind, sort_order)
VALUES
  ('snc',             'SNC',             'hors_assistance', 1),
  ('accident_police', 'Accident Police', 'hors_assistance', 2)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE  public.surcharge_clients   IS 'Clients ayant une grille de majoration dediee (assistance ou hors assistance).';
COMMENT ON TABLE  public.surcharge_schedules IS 'Plages horaires de majoration par client et jour. weekday 1=Lun..7=Dim (Dim couvre aussi les feries BE).';
COMMENT ON COLUMN public.surcharge_schedules.rate_dsp_pct IS 'Majoration % pour missions de type DSP (depannage). NULL si pas applicable.';
COMMENT ON COLUMN public.surcharge_schedules.rate_rem_pct IS 'Majoration % pour missions de type REM/REL (remorquage). NULL si pas applicable.';
