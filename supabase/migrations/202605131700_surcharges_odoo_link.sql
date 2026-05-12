-- ============================================================
-- Surcharges — liaison avec partenaire Odoo
-- ============================================================
-- Permet de lier un client de la matrice de majorations a un partenaire Odoo
-- (cohesion avec les missions, qui referencent egalement Odoo). La cle technique
-- reste utilisee pour matcher mission.source mais l'admin choisit via recherche
-- Odoo (pas de saisie libre).

ALTER TABLE public.surcharge_clients
  ADD COLUMN IF NOT EXISTS odoo_partner_id integer;

CREATE INDEX IF NOT EXISTS idx_surcharge_clients_odoo
  ON public.surcharge_clients(odoo_partner_id)
  WHERE odoo_partner_id IS NOT NULL;

COMMENT ON COLUMN public.surcharge_clients.odoo_partner_id IS
  'ID du partenaire Odoo (res.partner.id) lie a ce client. Permet la coherence avec les missions.';
