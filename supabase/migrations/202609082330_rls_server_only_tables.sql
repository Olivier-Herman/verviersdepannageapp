-- 202609082330_rls_server_only_tables
--
-- Alerte Supabase du 06/09/2026 « Table publicly accessible » (rls_disabled_in_public).
-- Vérifié le 08/09 avec la clé anon (celle du navigateur) : GET 200 et DELETE 204
-- sur mail_agent_items, vehicle_sales, vehicle_sale_bids, boutades ; GET 200 sur
-- payment_advices. Ces 9 tables ne sont lues QUE côté serveur (service_role) :
-- RLS activé sans policy + aucun droit pour anon/authenticated = l'app marche,
-- le public n'y touche plus. Même recette que mission_position_pings (202606162130).

do $$
declare t text;
begin
  foreach t in array array[
    'boutades', 'mail_agent_items', 'payment_advices', 'vehicle_sale_bids', 'vehicle_sales',
    'dossier_locks', 'payout_reconciliations', 'payout_reference_overrides', 'payout_unallocated_lines'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role, postgres', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
