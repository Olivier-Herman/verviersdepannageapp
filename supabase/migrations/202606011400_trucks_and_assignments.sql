-- Olivier 2026-06-01 : module Depanneuses (trucks) + assignation au chauffeur.
--
-- CONTEXTE
-- Avant : incoming_missions.vehicle_plate = plaque du VEHICULE CLIENT remorque.
-- Aucun lien avec la depanneuse VD utilisee par le chauffeur. Probleme : pour
-- les amendes / PV recus par VD, on ne pouvait pas matcher quel chauffeur etait
-- au volant.
--
-- APRES
-- - Table 'trucks' : repertoire des depanneuses VD (nom + plaque + infos).
-- - users.default_truck_id : depanneuse habituelle d un chauffeur (config admin).
-- - users.current_truck_id : depanneuse actuellement en service (peut differer
--   du default si rotation ponctuelle). + current_truck_set_at pour piloter
--   le modal de confirmation 7h/17h.
-- - incoming_missions.truck_id : depanneuse reellement utilisee sur la mission
--   (snapshot du current_truck_id au moment de l acceptation/demarrage).
--   C est ce champ qu on utilise pour le matching amendes.

-- 1) Table trucks
CREATE TABLE IF NOT EXISTS public.trucks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,           -- ex "Vanette 3", "Plateau Iveco", etc.
  plate       text NOT NULL,           -- plaque de la depanneuse (utilisee pour matching amendes)
  brand       text,
  model       text,
  year        int,
  active      boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 100,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trucks_plate_active
  ON public.trucks(plate) WHERE active = true;

ALTER TABLE public.trucks DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.trucks TO service_role;

COMMENT ON TABLE public.trucks IS
  'Repertoire des depanneuses VD. Olivier 2026-06-01. Geres via /admin/trucks (admin/superadmin).';

-- 2) Liens sur users : default + current
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS default_truck_id     uuid REFERENCES public.trucks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_truck_id     uuid REFERENCES public.trucks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_truck_set_at timestamptz;

COMMENT ON COLUMN public.users.default_truck_id IS
  'Depanneuse habituelle du chauffeur. Configuree par admin dans /admin/users. Sert de defaut lors de la confirmation matinale.';
COMMENT ON COLUMN public.users.current_truck_id IS
  'Depanneuse actuellement en service. Peut differer du default si rotation ponctuelle. Mise a jour par le chauffeur via le modal 7h/17h ou bouton manuel.';
COMMENT ON COLUMN public.users.current_truck_set_at IS
  'Quand le chauffeur a confirme/choisi sa depanneuse. Sert au modal qui se re-declenche apres les seuils 7h et 17h.';

-- 3) Lien sur incoming_missions
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS truck_id uuid REFERENCES public.trucks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_truck_id
  ON public.incoming_missions(truck_id) WHERE truck_id IS NOT NULL;

COMMENT ON COLUMN public.incoming_missions.truck_id IS
  'Depanneuse utilisee sur cette mission. Snapshot du users.current_truck_id au moment de l acceptation/demarrage. Sert au matching amendes (PV via truck.plate).';

NOTIFY pgrst, 'reload schema';
