-- ============================================================
-- Audit + fix global GRANT service_role sur toutes les tables public
-- ============================================================
-- Bug systemique detecte en 2 endroits (invoice_reminders + cash_transfers) :
-- les tables creees sans GRANT explicite au service_role bloquent les routes
-- API qui utilisent createAdminClient.
--
-- Cette migration :
--   1. Liste les tables a risque (sans INSERT service_role) -> RAISE NOTICE
--   2. Applique GRANT ALL TO service_role + postgres pour chacune
--   3. Definit les privileges par defaut pour eviter le bug sur les futures
--      tables creees dans public.

-- ── Etape 1 + 2 : fix global ────────────────────────────────
DO $$
DECLARE
  r record;
  fixed_count int := 0;
BEGIN
  FOR r IN
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public'
          AND g.table_name = t.table_name
          AND g.grantee = 'service_role'
          AND g.privilege_type = 'INSERT'
      )
    ORDER BY t.table_name
  LOOP
    EXECUTE format('GRANT ALL ON public.%I TO service_role', r.table_name);
    EXECUTE format('GRANT ALL ON public.%I TO postgres',     r.table_name);
    RAISE NOTICE 'GRANT ALL applique sur public.%', r.table_name;
    fixed_count := fixed_count + 1;
  END LOOP;
  RAISE NOTICE '=> Total tables corrigees : %', fixed_count;
END $$;

-- Idem pour les sequences (auto-increment IDs, au cas ou)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
  LOOP
    EXECUTE format('GRANT ALL ON SEQUENCE public.%I TO service_role', r.sequence_name);
    EXECUTE format('GRANT ALL ON SEQUENCE public.%I TO postgres',     r.sequence_name);
  END LOOP;
END $$;

-- ── Etape 3 : privileges par defaut pour les FUTURES tables ──
-- A partir de maintenant, toute table creee dans public aura
-- automatiquement GRANT ALL au service_role (plus de bug en cascade).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO service_role;

-- Idem pour postgres
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres;

-- ── Verification post-execution ─────────────────────────────
-- Pour verifier qu il n y a plus de tables sans GRANT INSERT service_role,
-- executer cette requete (doit retourner 0 ligne) :
--
-- SELECT t.table_name
-- FROM information_schema.tables t
-- WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
--   AND NOT EXISTS (
--     SELECT 1 FROM information_schema.role_table_grants g
--     WHERE g.table_schema = 'public' AND g.table_name = t.table_name
--       AND g.grantee = 'service_role' AND g.privilege_type = 'INSERT'
--   );
