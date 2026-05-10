-- ============================================================
-- Module Relance Client — Fix permissions service_role
-- ============================================================
-- La migration 202605101700_relances_module.sql avait DISABLE RLS
-- mais oublie les GRANT explicites au role service_role. Resultat :
-- "permission denied for table invoice_reminders" au moment de l INSERT
-- depuis les routes API qui utilisent createAdminClient (service_role).
--
-- Fix : grant complet sur la table + sequence (au cas ou) au service_role.
-- C est le pattern utilise par les autres tables app du projet.

GRANT ALL ON public.invoice_reminders TO service_role;
GRANT ALL ON public.invoice_reminders TO postgres;
GRANT SELECT ON public.invoice_reminders TO authenticated;

-- Pas de sequence sur cette table (uuid PK genere par gen_random_uuid).

-- Verification rapide :
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_name = 'invoice_reminders';
