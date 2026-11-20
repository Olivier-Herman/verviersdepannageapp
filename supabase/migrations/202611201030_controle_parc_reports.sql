-- Contrôle aléatoire du parc : reports comptés et 4e report sur accord de Mobi (Olivier 20/11/2026, contrôle du 19/11
-- jamais fait). 3 reports de 15 min libres, puis une demande motivée acceptée ou refusée, puis plus aucun.
-- Cf src/lib/parc/controle-aleatoire.ts (repousser, demanderProlongation, deciderProlongation).
alter table public.parc_controles_aleatoires
  add column if not exists reports                      int not null default 0,
  add column if not exists reporte_jusqua               timestamptz,
  add column if not exists prolongation                 text,          -- demandee | acceptee | refusee
  add column if not exists prolongation_motif           text,
  add column if not exists prolongation_par             uuid,
  add column if not exists prolongation_par_name        text,
  add column if not exists prolongation_at              timestamptz,
  add column if not exists prolongation_decide_par_name text,
  add column if not exists prolongation_decide_at       timestamptz;

insert into app_settings (key, value, updated_at) values
  ('controle_parc_reports_max', '3', now()),
  ('controle_parc_validateur_user_ids', '["29df3445-f452-4ebc-a7bb-c16a8377289b"]', now())
on conflict (key) do nothing;

notify pgrst, 'reload schema';
