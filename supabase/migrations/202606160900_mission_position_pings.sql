-- supabase/migrations/202606160900_mission_position_pings.sql
--
-- Olivier 2026-06-16 : historique des positions GPS d'une mission, pour
-- afficher le TRAJET du chauffeur (polyline) + les LIEUX de pointage sur une
-- carte Google dans la fiche dispatch.
--
-- Deux sources alimentent cette table :
--   1. Le ping GPS « en service » (toutes les 30s, cf useOnDutyPing) — quand le
--      chauffeur a une mission active, chaque ping y insère une ligne kind='ping'.
--      → c'est le TRACÉ continu de la mise en route à la clôture.
--   2. Chaque pointage chauffeur (accept / on_way / on_site / load_vehicle /
--      park / completed / start_delivery / complete_delivery) — la position au
--      moment du clic est enregistrée avec kind = l'action.
--      → ce sont les MARQUEURS de pointage (dont le point d'acceptation).
--
-- Best-effort partout : si l'insert échoue ou si le GPS est refusé, le
-- pointage/ping fonctionne quand même. Aucune donnée critique ici.

CREATE TABLE IF NOT EXISTS public.mission_position_pings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  mission_id   UUID NOT NULL,                 -- incoming_missions.id (pas de FK dure : table de télémétrie)
  driver_id    UUID,                          -- users.id du chauffeur

  lat          NUMERIC(10,6) NOT NULL,
  lng          NUMERIC(10,6) NOT NULL,

  -- 'ping' = position périodique (trajet) ; sinon = nom de l'action de pointage
  kind         TEXT NOT NULL DEFAULT 'ping',

  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lecture principale : toutes les positions d'une mission, dans l'ordre.
CREATE INDEX IF NOT EXISTS idx_mission_position_pings_mission
  ON public.mission_position_pings (mission_id, recorded_at);

ALTER TABLE public.mission_position_pings DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.mission_position_pings TO service_role;
GRANT SELECT ON public.mission_position_pings TO authenticated;

COMMENT ON TABLE public.mission_position_pings IS
  'Historique GPS par mission : kind=ping (trajet, ping 30s en service) ou kind=action '
  '(lieu de pointage accept/on_way/on_site/load_vehicle/park/completed). Alimente la carte '
  'trajet de la fiche dispatch. Best-effort, non critique.';

NOTIFY pgrst, 'reload schema';
