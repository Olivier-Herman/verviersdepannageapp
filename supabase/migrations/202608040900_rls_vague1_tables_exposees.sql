-- Vague 1 sécurité RLS : fermer les tables réellement exposées au rôle anon.
-- Contexte : advisor Supabase "rls_disabled_in_public" (03/08/2026). Sur 52 tables
-- RLS-off, seules 6 avaient un GRANT anon → réellement accessibles avec la clé
-- publique embarquée dans l'app web. Tous les accès applicatifs passent par
-- service_role (contourne RLS), sauf customer_display (écran client public, lecture
-- seule via realtime).

-- 5 tables : anon avait TOUS les droits (select/insert/update/delete/truncate).
-- Aucun code navigateur ne les utilise → révocation + RLS.
revoke all on table public.garage_closures            from anon, authenticated;
revoke all on table public.mission_billing_remarks     from anon, authenticated;
revoke all on table public.mission_driver_instructions from anon, authenticated;
revoke all on table public.schedule_periods            from anon, authenticated;
revoke all on table public.tgr_supervisor_tokens       from anon, authenticated;

alter table public.garage_closures            enable row level security;
alter table public.mission_billing_remarks     enable row level security;
alter table public.mission_driver_instructions enable row level security;
alter table public.schedule_periods            enable row level security;
alter table public.tgr_supervisor_tokens       enable row level security;

-- customer_display : écran client PUBLIC, lecture seule via realtime (rôle anon).
-- On garde le SELECT anon, on active RLS avec une policy de lecture, et on s'assure
-- qu'anon n'a AUCUN droit d'écriture (le montant est écrit côté serveur/service_role).
revoke insert, update, delete, truncate, references, trigger
  on table public.customer_display from anon, authenticated;
alter table public.customer_display enable row level security;
drop policy if exists customer_display_public_read on public.customer_display;
create policy customer_display_public_read
  on public.customer_display for select to anon, authenticated using (true);

notify pgrst, 'reload schema';
