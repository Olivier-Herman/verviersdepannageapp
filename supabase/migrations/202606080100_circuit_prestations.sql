-- src/supabase/migrations/202606080100_circuit_prestations.sql
--
-- Olivier 2026-06-08 : module Prestations Circuit de Spa-Francorchamps.
-- 2 types de prestations :
--   - 'incentive'  : 8h-18h, 1 a 6 depanneuses
--   - 'after_six'  : 18h-20h, 1 depanneuse (toujours)
--
-- Workflow :
--   1. Olivier (ou tout dispatcher) recoit le calendrier mensuel mi-mois
--   2. Encode chaque prestation via /circuit -> bouton "Ajouter"
--   3. A la creation, un devis Odoo confirme (sale.order state='sale') est
--      genere automatiquement avec une ligne par jour de prestation.
--   4. Chaque lundi 12h (cron), notif push aux dispatchers + admins
--      listant les prestations de la semaine passee a facturer (lien
--      direct vers chaque devis Odoo).
--
-- Refs produits Odoo (deja existantes en BDD Odoo) :
--   - default_code = 'Incentive'
--   - default_code = 'After6'

CREATE TABLE IF NOT EXISTS public.circuit_prestations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  client_name       TEXT NOT NULL,
  client_odoo_id    INTEGER,                                  -- res.partner.id Odoo (recherche au moment de l ajout)

  type              TEXT NOT NULL CHECK (type IN ('incentive', 'after_six')),
  prestation_date   DATE NOT NULL,                            -- 1 ligne par jour de prestation
  nb_depanneuses    SMALLINT NOT NULL DEFAULT 1 CHECK (nb_depanneuses BETWEEN 1 AND 6),

  -- Lien vers le devis Odoo cree (cf createSaleOrder helper)
  odoo_sale_order_id INTEGER,
  odoo_sale_order_name TEXT,                                  -- nom human-readable du devis (S00123)

  -- Notes libres
  notes             TEXT,

  -- Audit
  created_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Statut facturation
  invoiced_at       TIMESTAMPTZ,                              -- timestamp quand le devis a ete transforme en facture (manuel pour l instant)
  invoiced_by       UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_circuit_prestations_date
  ON public.circuit_prestations (prestation_date);

CREATE INDEX IF NOT EXISTS idx_circuit_prestations_client_odoo
  ON public.circuit_prestations (client_odoo_id);

-- Filtre "a facturer" = pas encore facturees, prestation passee
CREATE INDEX IF NOT EXISTS idx_circuit_prestations_to_invoice
  ON public.circuit_prestations (prestation_date)
  WHERE invoiced_at IS NULL;

ALTER TABLE public.circuit_prestations DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.circuit_prestations TO service_role;
GRANT SELECT ON public.circuit_prestations TO authenticated;

COMMENT ON TABLE public.circuit_prestations IS
  'Prestations dispatchees au circuit de Spa-Francorchamps (Incentive 8h-18h ou After-Six 18h-20h). '
  'Chaque ligne = 1 jour de prestation. Devis Odoo confirme a la creation, facturation declenchee '
  'humainement apres notification lundi 12h (cf cron /api/cron/circuit-weekly-reminder).';

NOTIFY pgrst, 'reload schema';
