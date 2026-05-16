-- ============================================================
-- 202605161400_decharges_grants_fix
-- ============================================================
-- Fix : "permission denied for table discharge_types" cote API admin.
-- Cause : la migration 202605160900 a active RLS sans GRANT ALL au
-- service_role. Bien que service_role bypass RLS, il a besoin des
-- privileges Postgres de base (INSERT/UPDATE/DELETE) pour acceder a
-- la table.
--
-- Idem pour user_auth_providers (migration 202605161200) - meme fix
-- preventif.
-- ============================================================

GRANT ALL ON public.discharge_types     TO service_role;
GRANT ALL ON public.user_auth_providers TO service_role;
