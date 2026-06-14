-- ============================================================
-- 202606141200_saisie_parked_at_intervention
-- ============================================================
-- Olivier 2026-06-14 — Police Saisie : l'entrée parc (parked_at) doit être la
-- date d'intervention, pas la date de mise en dépôt / création de la fiche.
-- Le gardiennage saisie est compté depuis parked_at ; il doit donc démarrer à
-- l'intervention.
--
-- Going-forward : driver-action cale parked_at = intervention_date à la mise en
-- parc d'une saisie. Ici on corrige les saisies déjà en parc.
-- ============================================================

UPDATE public.incoming_missions
SET parked_at = intervention_date
WHERE source = 'police_saisie'
  AND parked_at IS NOT NULL
  AND intervention_date IS NOT NULL
  AND parked_at <> intervention_date;

NOTIFY pgrst, 'reload schema';
