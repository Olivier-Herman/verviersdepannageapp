-- Écran client face-comptoir : état par écran (repos / facture affichée).
-- Lu en temps réel par la page kiosque (anon), écrit par l'encaissement (service_role).

create table if not exists public.customer_display (
  key         text primary key,        -- identifiant écran (ex: 'facturation')
  label       text,
  payload     jsonb,                    -- null = repos ; sinon la facture à afficher
  expires_at  timestamptz,             -- au-delà → repos (timeout 5 min)
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- Accès client (kiosque = anon realtime) ; service_role écrit.
alter table public.customer_display disable row level security;
grant select on public.customer_display to anon, authenticated;
grant all    on public.customer_display to service_role;

-- Realtime : diffuser les changements à la page kiosque.
do $$ begin
  alter publication supabase_realtime add table public.customer_display;
exception when duplicate_object then null; end $$;

-- Écran par défaut du bureau facturation (Phase 1).
insert into public.customer_display (key, label) values ('facturation', 'Bureau facturation')
  on conflict (key) do nothing;

notify pgrst, 'reload schema';
