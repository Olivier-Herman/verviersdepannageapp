-- Job Kaze de la RELIVRAISON, distinct du kaze_job_id du remorquage parent.
-- Posé quand une relivraison Kaze est fusionnée dans la fiche en parc (confirm),
-- puis hérité par la relivraison généralisée (create-relivraison) → chaque job
-- Kaze (REM + REL) se clôture indépendamment.
alter table public.incoming_missions
  add column if not exists rel_kaze_job_id text;

notify pgrst, 'reload schema';
