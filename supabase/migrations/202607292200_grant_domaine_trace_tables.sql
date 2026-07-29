-- Fix : les tables de trace Domaine ont RLS activé mais AUCUN GRANT au
-- service_role → l'app (service_role) reçoit « permission denied » (42501) en
-- lecture ET écriture. Le GRANT est distinct du bypass RLS : même avec
-- BYPASSRLS, service_role a besoin du privilège table. Sans ça : inserts de
-- trace avalés en silence + GET du tableau en 403 → « erreur serveur ».
-- (cf. feedback_rls_check : server-only = ENABLE RLS + GRANT service_role.)

grant all privileges on table domaine_dates_in      to service_role;
grant all privileges on table domaine_ventes_epaves to service_role;

notify pgrst, 'reload schema';
