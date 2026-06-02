-- Olivier 2026-06-02 : Espace client garages (Phase 1.1 — tables + admin CRUD).
-- Cf [[project-espace-client-garages]] pour le cadrage complet.
--
-- Modele :
--   - garage_partners : 1 ligne par entite (un meme garage peut avoir
--     plusieurs entites = plusieurs partner_id Odoo distincts)
--   - garage_tariffs : 1 ligne par garage_partner (3 tarifs : DSP/REM/DPR)
--   - garage_user_partners : many-to-many user <-> garage_partners.
--     Un meme user (email) peut avoir acces a plusieurs entites.
--   - garage_cancellation_requests : workflow annulation post-acceptation
--     (pattern derogations paiement). Le dispatch decide : annulation
--     totale OU facturation deplacement (DPR).

-- ─── Table garage_partners ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.garage_partners (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  odoo_partner_id  int,                            -- lien Odoo pour facturation, NULL = a renseigner
  contact_email    text,                           -- email principal (info ; pas auth, voir garage_user_partners)
  contact_phone    text,
  address          text,
  notes            text,                           -- notes internes (visibles admin/dispatch uniquement)
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garage_partners_active
  ON public.garage_partners(active, name) WHERE active = true;

ALTER TABLE public.garage_partners DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.garage_partners TO service_role;
GRANT SELECT ON public.garage_partners TO authenticated;

COMMENT ON TABLE public.garage_partners IS
  'Garages partenaires ayant acces a leur espace /garage. Crees manuellement
   par admin dans /admin/garage-partners. Cf [[project-espace-client-garages]].';
COMMENT ON COLUMN public.garage_partners.odoo_partner_id IS
  'ID du partner cote Odoo (res.partner). Olivier renseigne manuellement
   apres creation du partner Odoo. Utilise pour facturation automatique.';

-- ─── Table garage_tariffs ──────────────────────────────────────────
-- 3 tarifs TVAC par garage : DSP, REM, DPR.
-- Si dpr_price NULL → fallback dsp_price au calcul (Olivier 2026-06-02).
CREATE TABLE IF NOT EXISTS public.garage_tariffs (
  garage_partner_id  uuid PRIMARY KEY REFERENCES public.garage_partners(id) ON DELETE CASCADE,
  dsp_price          numeric(10,2),
  rem_price          numeric(10,2),
  dpr_price          numeric(10,2),
  currency           text NOT NULL DEFAULT 'EUR',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.garage_tariffs DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.garage_tariffs TO service_role;
GRANT SELECT ON public.garage_tariffs TO authenticated;

COMMENT ON TABLE public.garage_tariffs IS
  'Tarifs TVAC par garage. 3 tarifs : DSP (depannage sur place), REM (remorquage),
   DPR (deplacement pour rien — utilise pour annulation post-acceptation). Si
   dpr_price NULL → fallback dsp_price au calcul.';

-- ─── Table garage_user_partners ────────────────────────────────────
-- Many-to-many : un user (role=garage) peut etre lie a plusieurs garage_partners.
-- last_selected_at = utilise pour memoriser la derniere entite choisie au login
-- (decision 2B : pas d ecran de choix force, on memorise).
CREATE TABLE IF NOT EXISTS public.garage_user_partners (
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  garage_partner_id  uuid NOT NULL REFERENCES public.garage_partners(id) ON DELETE CASCADE,
  last_selected_at   timestamptz,
  is_default         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, garage_partner_id)
);

CREATE INDEX IF NOT EXISTS idx_gup_user_partners
  ON public.garage_user_partners(user_id, last_selected_at DESC NULLS LAST);

ALTER TABLE public.garage_user_partners DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.garage_user_partners TO service_role;
GRANT SELECT ON public.garage_user_partners TO authenticated;

COMMENT ON TABLE public.garage_user_partners IS
  'Liaison many-to-many users <-> garage_partners. Un user (role=garage) peut
   avoir acces a plusieurs entites avec la meme adresse email. last_selected_at
   memorise la derniere entite utilisee pour le pre-select au prochain login.';

-- ─── Table garage_cancellation_requests ────────────────────────────
-- Workflow annulation post-acceptation : le garage demande l annulation,
-- le dispatch decide (totale OU facturation deplacement DPR).
CREATE TABLE IF NOT EXISTS public.garage_cancellation_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id               uuid NOT NULL REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  requested_by_garage_id   uuid NOT NULL REFERENCES public.garage_partners(id),
  requested_by_user_id     uuid REFERENCES public.users(id),
  requested_at             timestamptz NOT NULL DEFAULT now(),
  reason                   text,
  status                   text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved_total', 'approved_billing_dpr', 'refused')),
  decided_by_user_id       uuid REFERENCES public.users(id),
  decided_at               timestamptz,
  decision_note            text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gcr_pending
  ON public.garage_cancellation_requests(status, requested_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_gcr_mission
  ON public.garage_cancellation_requests(mission_id);

ALTER TABLE public.garage_cancellation_requests DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.garage_cancellation_requests TO service_role;
GRANT SELECT ON public.garage_cancellation_requests TO authenticated;

COMMENT ON TABLE public.garage_cancellation_requests IS
  'Demandes d annulation des garages apres acceptation par dispatch. Pattern
   identique aux derogations paiement. Le dispatch decide : approved_total
   (annulation pure) ou approved_billing_dpr (facturation deplacement = DPR).';

-- ─── Etend incoming_missions ───────────────────────────────────────
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS requested_by_garage_id    uuid REFERENCES public.garage_partners(id),
  ADD COLUMN IF NOT EXISTS photos_visible_to_garage  boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_im_requested_by_garage
  ON public.incoming_missions(requested_by_garage_id, received_at DESC)
  WHERE requested_by_garage_id IS NOT NULL;

COMMENT ON COLUMN public.incoming_missions.requested_by_garage_id IS
  'Si la mission a ete creee depuis l espace /garage, lien vers le garage
   demandeur. Sinon NULL. Filtre RLS-like pour que le garage ne voie que
   ses propres missions.';
COMMENT ON COLUMN public.incoming_missions.photos_visible_to_garage IS
  'Toggle dispatch. Par defaut FALSE : les photos ne sont pas visibles cote
   garage. Le dispatch active explicitement quand approprie.';

NOTIFY pgrst, 'reload schema';
