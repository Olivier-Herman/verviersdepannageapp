-- Grants service_role pour le module Visiteur (RLS ON mais les routes API
-- passent en service_role → il faut le GRANT explicite, sinon « permission
-- denied for table ». Cf convention reception_motifs. Olivier 2026-08-08.
grant all on public.visitor_motifs    to service_role;
grant all on public.expertise_bureaus to service_role;
grant all on public.mission_visitors  to service_role;

notify pgrst, 'reload schema';
