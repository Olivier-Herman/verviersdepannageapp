-- Compteur des calculs d'itinéraire et d'adresse (Olivier 02/10/2026).
--
-- Une ligne par jour (Bruxelles) × fournisseur × service × origine, avec le
-- nombre d'appels. But : savoir avec des chiffres si le quota gratuit
-- OpenRouteService suffit (2 000 itinéraires / jour) et voir tout de suite un
-- appel Google (payant) qui ne devrait pas avoir lieu. Lu dans Admin →
-- Diagnostics.
--   provider : 'memoire' (trajet déjà connu, gratuit), 'ors' (gratuit, quota),
--              'google' (payant)
--   service  : 'itineraire', 'matrice', 'adresse'
--   origin   : 'humain' (geste humain, mode payant autorisé) ou 'auto'
--              (robot ou écran qui s'affiche seul)

create table if not exists public.routing_usage (
  day       date    not null,
  provider  text    not null check (provider in ('memoire', 'ors', 'google')),
  service   text    not null check (service in ('itineraire', 'matrice', 'adresse')),
  origin    text    not null check (origin in ('humain', 'auto')),
  calls     integer not null default 0,
  failures  integer not null default 0,
  primary key (day, provider, service, origin)
);

comment on table public.routing_usage is
  'Compteur journalier des appels d''itinéraire / géocodage par fournisseur (memoire, ors, google). Écrit par src/lib/routing/usage.ts.';

-- Incrément atomique (plusieurs fonctions Vercel en parallèle).
create or replace function public.routing_usage_bump(p_provider text, p_service text, p_origin text, p_failed boolean default false)
returns void language sql as $$
  insert into public.routing_usage (day, provider, service, origin, calls, failures)
  values ((now() at time zone 'Europe/Brussels')::date, p_provider, p_service, p_origin, 1, case when p_failed then 1 else 0 end)
  on conflict (day, provider, service, origin)
  do update set calls = public.routing_usage.calls + 1,
                failures = public.routing_usage.failures + case when p_failed then 1 else 0 end;
$$;

alter table public.routing_usage enable row level security;
grant all on public.routing_usage to service_role;
grant execute on function public.routing_usage_bump(text, text, text, boolean) to service_role;

notify pgrst, 'reload schema';
