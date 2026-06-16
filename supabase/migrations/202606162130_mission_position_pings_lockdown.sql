-- supabase/migrations/202606162130_mission_position_pings_lockdown.sql
--
-- Olivier 2026-06-16 : sécurisation de mission_position_pings.
--
-- Cette table de géolocalisation n'est lue/écrite QUE par des routes API en
-- service_role (ping-location, driver-action, route-track). Aucun accès direct
-- par la clé publique (anon) côté navigateur. On peut donc ACTIVER le RLS sans
-- policy : service_role contourne le RLS → l'app continue de fonctionner, mais
-- la clé publique ne voit RIEN. C'est le standard Supabase sécurisé, et ça
-- répond à l'alerte « rls_disabled_in_public » pour cette table.
--
-- ⚠️ Exception volontaire à la règle « DISABLE RLS sur nouvelle table » :
-- cette règle vaut pour les tables lues par le client anon. Ici, accès 100 %
-- serveur → RLS activé = plus sûr, sans rien casser.

ALTER TABLE public.mission_position_pings ENABLE ROW LEVEL SECURITY;

-- Aucun droit pour le public / la clé anon / les utilisateurs anon-auth.
REVOKE ALL ON public.mission_position_pings FROM anon, authenticated, public;

-- service_role : accès complet (contourne le RLS de toute façon).
GRANT ALL ON public.mission_position_pings TO service_role;

NOTIFY pgrst, 'reload schema';
