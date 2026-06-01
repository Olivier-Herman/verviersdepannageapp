-- Olivier 2026-06-01 : module Amendes (PV reçus).
--
-- Workflow :
-- 1. Admin/facturation reçoit un PV par courrier
-- 2. Saisie via /amendes : photo + date/heure + plaque + lieu + montant
-- 3. App suggere le chauffeur qui roulait (match auto via missions a la date)
-- 4. Validation/correction manuelle
-- 5. Email a la boite achats (meme adresse que /avance-fonds) avec PV en PJ
-- 6. Stats par chauffeur via /admin/amendes
--
-- Reserve facturation / admin / superadmin.

CREATE TABLE IF NOT EXISTS public.fines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Infos du PV
  photo_url               text NOT NULL,
  infraction_date         timestamptz NOT NULL,
  infraction_place        text,
  infraction_type         text,             -- 'speeding', 'parking', 'red_light', 'other', etc.
  infraction_ref          text,             -- numero du PV
  amount                  numeric(10, 2) NOT NULL,

  -- Vehicule concerne
  plate                   text NOT NULL,
  vehicle_odoo_id         integer,          -- id fleet.vehicle Odoo si trouve

  -- Chauffeur identifie (au volant au moment de l infraction)
  driver_id               uuid REFERENCES public.users(id) ON DELETE SET NULL,
  driver_match_method     text,             -- 'auto' (match auto via mission) | 'manual' (choisi par l user) | 'none'
  driver_match_confidence text,             -- 'high' | 'medium' | 'low' | null

  -- Mission liee si trouvee (permet click-through depuis amendes vers mission)
  mission_id              uuid REFERENCES public.incoming_missions(id) ON DELETE SET NULL,

  -- Workflow
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'sent_to_purchase', 'paid', 'disputed', 'cancelled')),
  notes                   text,

  -- Notification compta
  purchase_email_sent     boolean NOT NULL DEFAULT false,
  purchase_email_sent_at  timestamptz,

  -- Metadonnees
  created_by              uuid REFERENCES public.users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fines_driver_id        ON public.fines(driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fines_plate            ON public.fines(plate);
CREATE INDEX IF NOT EXISTS idx_fines_infraction_date  ON public.fines(infraction_date DESC);
CREATE INDEX IF NOT EXISTS idx_fines_mission_id       ON public.fines(mission_id) WHERE mission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fines_status           ON public.fines(status);

-- RLS DISABLED + GRANT (cf [[rls-check]])
ALTER TABLE public.fines DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.fines TO service_role;

COMMENT ON TABLE public.fines IS
  'Amendes / PV recus. Saisie admin via /amendes, email achats automatique, stats par chauffeur. Olivier 2026-06-01.';
COMMENT ON COLUMN public.fines.driver_match_method IS
  'Comment le chauffeur a ete identifie : auto (suggestion via mission active a la date), manual (choix utilisateur), ou none (aucun match trouve, attribue manuellement plus tard).';

-- Bucket Storage pour les photos de PV
INSERT INTO storage.buckets (id, name, public)
VALUES ('fines', 'fines', false)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
