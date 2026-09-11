-- Olivier 11/09/2026 : une ligne d'avis peut aussi être une REPRISE (facture
-- déjà réglée que l'assureur déduit). Décision « rouvrir la facture » :
-- account_id = 206 (créance) + meta = { invoice_id, invoice_name, credit_line_id }.
alter table payout_unallocated_lines add column if not exists meta jsonb;
