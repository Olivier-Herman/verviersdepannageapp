-- ============================================================
-- Sync paiements espèces Odoo → caisse app
-- Phase 2 du chantier caisse, créé le 2026-05-04.
-- À COLLER DANS Supabase SQL Editor avant le déploiement du cron.
-- ============================================================

-- 1. Référence du paiement Odoo (pour dédup native via UNIQUE INDEX partiel).
--    NULL pour tous les mouvements non issus d'Odoo (encaissements interventions, transferts, etc.).
ALTER TABLE cash_register
  ADD COLUMN IF NOT EXISTS odoo_payment_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_register_odoo_payment_id
  ON cash_register(odoo_payment_id)
  WHERE odoo_payment_id IS NOT NULL;

-- 2. État de validation des mouvements Odoo (pending → confirmed après 30 min + re-vérif).
--    Valeurs :
--      • 'pending'   : créé immédiatement à la détection, en attente de confirmation à 30 min.
--      • 'confirmed' : vérifié après 30 min, méthode toujours espèces.
--      • NULL        : mouvement non lié à Odoo (encaissement intervention, remise, reception…).
ALTER TABLE cash_register
  ADD COLUMN IF NOT EXISTS odoo_status text;

-- Index pour accélérer la requête "trouver les pending arrivés à échéance"
CREATE INDEX IF NOT EXISTS idx_cash_register_odoo_status_pending
  ON cash_register(created_at)
  WHERE odoo_status = 'pending';

-- ============================================================
-- Note : la colonne users.odoo_user_id et le mapping des 3 users
-- (Mobi, Jonathan, Momo) ont déjà été appliqués lors de la Phase 1.
-- ============================================================
