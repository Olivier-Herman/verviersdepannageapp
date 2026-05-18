-- ============================================================
-- 202605181000_stats_module
-- ============================================================
-- Ajoute le module 'stats' au catalogue. Activable par user via
-- /admin/users (toggle modules accessibles).
--
-- Aucune nouvelle table — les stats sont des agregations en live sur
-- les tables existantes (incoming_missions, mission_logs, interventions,
-- dispatch_attempts_log). Si les perf deviennent un probleme, on
-- ajoutera des index ou une table de cache.
-- ============================================================

INSERT INTO public.modules (id, label, description, icon, sort_order, active)
VALUES ('stats', 'Statistiques', 'Tableau de bord stats volume + efficacité chauffeurs et sources', '📊', 90, true)
ON CONFLICT (id) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      icon        = EXCLUDED.icon,
      active      = true;

-- Index potentiellement utiles pour les agregations stats (les
-- analyseurs Postgres peuvent les ignorer si les volumes restent faibles,
-- mais c est defensif).
CREATE INDEX IF NOT EXISTS idx_incoming_missions_intervention_date
  ON public.incoming_missions (intervention_date)
  WHERE intervention_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_assigned_to_status
  ON public.incoming_missions (assigned_to, status)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_source
  ON public.incoming_missions (source)
  WHERE source IS NOT NULL;
