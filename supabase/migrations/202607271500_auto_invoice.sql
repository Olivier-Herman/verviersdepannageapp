-- Facturation automatique : marqueurs pour statistiques de couverture.
--   auto_invoiced        : true si la facture a été créée par le CRON (système)
--   invoice_created_by   : user qui a créé la facture/devis MANUELLEMENT (Jona…)
--   invoice_created_at   : quand
-- Olivier 2026-07-27.
ALTER TABLE incoming_missions ADD COLUMN IF NOT EXISTS auto_invoiced boolean NOT NULL DEFAULT false;
ALTER TABLE incoming_missions ADD COLUMN IF NOT EXISTS invoice_created_by uuid;
ALTER TABLE incoming_missions ADD COLUMN IF NOT EXISTS invoice_created_at timestamptz;

NOTIFY pgrst, 'reload schema';
