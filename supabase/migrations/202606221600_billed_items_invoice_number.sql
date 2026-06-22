-- N° de facture par facture partielle (lot = odoo_quote_id). Olivier 2026-06-22.
-- Permet d'indiquer le numéro de facture Odoo d'une facture partielle déjà émise.

ALTER TABLE mission_billed_items
  ADD COLUMN IF NOT EXISTS invoice_number text;

NOTIFY pgrst, 'reload schema';
