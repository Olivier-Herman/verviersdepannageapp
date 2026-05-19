-- ============================================================
-- 202605201100_incoming_missions_odoo_quote
-- ============================================================
-- Facturation Phase 2 : trace du devis Odoo (sale.order) cree depuis
-- l app pour une mission. Cf [[facturation-phase2]] :
--   - L app calcule les lignes (forfait + km + parc + surcharges)
--   - Push sale.order Odoo via 4 produits generiques (SERV-PEC/KM/PARC/MAJ)
--   - Odoo gere le partiel via qty_to_invoice (N factures sur 1 devis)
--
-- Idempotence : si odoo_quote_id existe deja, on update le sale.order
-- existant plutot que recreer.
-- ============================================================

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS odoo_quote_id   INTEGER,
  ADD COLUMN IF NOT EXISTS odoo_quote_url  TEXT,
  ADD COLUMN IF NOT EXISTS odoo_quoted_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_odoo_quote
  ON public.incoming_missions(odoo_quote_id) WHERE odoo_quote_id IS NOT NULL;

COMMENT ON COLUMN public.incoming_missions.odoo_quote_id  IS 'ID du sale.order Odoo cree depuis VD Soft (facturation Phase 2). Null si pas encore cree.';
COMMENT ON COLUMN public.incoming_missions.odoo_quote_url IS 'URL d acces direct au devis dans le client web Odoo.';
COMMENT ON COLUMN public.incoming_missions.odoo_quoted_at IS 'Date de derniere creation/maj du devis cote Odoo.';
