-- ============================================================
-- Fix permissions service_role sur cash_transfers
-- ============================================================
-- Bug detecte en prod le 11/05/2026 : "permission denied for table
-- cash_transfers" lors d un transfert Jona -> Mobi depuis /caisse.
--
-- Cause : la migration qui a cree cash_transfers (202605041201_cash_transfers.sql)
-- n a pas fait les GRANT explicites au role service_role. Du coup les routes API
-- qui utilisent createAdminClient (service_role) n ont pas access.
--
-- Meme pattern que le fix invoice_reminders du 10/05.

GRANT ALL ON public.cash_transfers TO service_role;
GRANT ALL ON public.cash_transfers TO postgres;
GRANT SELECT ON public.cash_transfers TO authenticated;

-- Verification :
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_name = 'cash_transfers';
