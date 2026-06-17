-- supabase/migrations/202606172300_circuit_invoice_number.sql
--
-- Olivier 2026-06-17 : champ numéro de facture sur les prestations circuit
-- (saisi à la main sur la carte une fois la facture émise dans Odoo).

ALTER TABLE public.circuit_prestations
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;

NOTIFY pgrst, 'reload schema';
