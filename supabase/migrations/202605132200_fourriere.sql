-- ============================================================
-- Module Fourrière — Phase 1A
-- ============================================================
-- Notre app verviers-app sert d'interface centralisee pour les mouvements
-- de vehicules entre zones fourriere. Source de verite = Odoo
-- fleet.vehicle.state_id (les zones sont des states pre-configures).
-- Cette table sert UNIQUEMENT a logger qui a deplace quoi quand depuis
-- notre app (audit trail). Les changements faits directement dans Odoo
-- (ou via Verviers-QR pendant la transition) ne sont pas captures ici.

-- 1) Module 'fourriere' (existe deja dans le type TS mais pas en BDD) ------

INSERT INTO public.modules (id, label, description, icon, sort_order, active)
VALUES ('fourriere', 'Fourrière', 'Gestion des véhicules en fourrière (zones A, B, C, ...)', '🚓', 75, true)
ON CONFLICT (id) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      icon        = EXCLUDED.icon,
      active      = true;

-- 2) Table audit des mouvements ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.fourriere_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  odoo_vehicle_id   integer NOT NULL,
  vehicle_plate     text,                  -- copie au moment du mouvement
  vehicle_brand     text,
  vehicle_model     text,
  from_state_id     integer,               -- NULL si entree initiale en fourriere
  from_state_name   text,
  to_state_id       integer NOT NULL,
  to_state_name     text,
  moved_by          uuid REFERENCES public.users(id),
  moved_at          timestamptz DEFAULT now(),
  notes             text
);

CREATE INDEX IF NOT EXISTS idx_fourriere_movements_vehicle
  ON public.fourriere_movements(odoo_vehicle_id, moved_at DESC);

CREATE INDEX IF NOT EXISTS idx_fourriere_movements_recent
  ON public.fourriere_movements(moved_at DESC);

GRANT ALL ON public.fourriere_movements TO service_role;

COMMENT ON TABLE  public.fourriere_movements IS
  'Audit log des deplacements de vehicules entre zones fourriere depuis verviers-app. La source de verite reste Odoo fleet.vehicle.state_id.';
