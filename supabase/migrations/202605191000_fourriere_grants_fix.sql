-- ============================================================
-- 202605191000_fourriere_grants_fix
-- ============================================================
-- Fix : "permission denied for sequence parc_rows_id_seq" cote API
-- admin quand on cree une ligne. BIGSERIAL cree une sequence
-- implicite qui n a pas herite des GRANT ALL ON TABLE.
-- ============================================================

GRANT USAGE, SELECT ON SEQUENCE public.parc_rows_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.parc_rows_id_seq TO authenticated;
