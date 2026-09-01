-- Suite du 202609010900 : le REVOKE au niveau TABLE n'avait pas suffi pour
-- UPDATE — le DELETE est bien passé en 401, mais le PATCH répondait encore 204.
-- Signe qu'il restait des droits AU NIVEAU COLONNE, que PostgreSQL traite
-- séparément et qu'un REVOKE sur la table ne touche pas.
--
-- On remet donc les droits à plat : on retire TOUT, puis on ne redonne que le
-- SELECT dont le realtime a besoin.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incoming_missions', 'notifications_log'] LOOP
    -- Droits colonne par colonne (invisibles depuis un REVOKE sur la table).
    EXECUTE format(
      'REVOKE ALL (%s) ON TABLE public.%I FROM anon, authenticated',
      (SELECT string_agg(quote_ident(column_name), ', ')
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t),
      t);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', t);
    -- Lecture seule : c'est ce qui fait vivre le realtime du dispatch, de la
    -- facturation, de la liste chauffeur et des notifications in-app.
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
