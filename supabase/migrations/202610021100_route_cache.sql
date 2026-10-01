-- Mémoire des trajets routiers (Olivier 02/10/2026).
--
-- Chaque trajet A → B calculé (OpenRouteService ou Google) est gardé ici, rangé
-- par coordonnées arrondies à 4 décimales (~11 m) et par préférence
-- (fastest = ETA, shortest = facturation). Un dossier dont l'adresse change a
-- d'autres coordonnées, donc une autre clé : le trajet est recalculé, jamais
-- servi périmé. Le prix, lui, est toujours recalculé à partir de la fiche.
--
-- But : stopper la facture Google (1 330 € en septembre). Les mêmes trajets
-- étaient recalculés en boucle par les listes de facturation et les robots ;
-- le quota gratuit ORS s'épuisait et tout partait chez Google.

create table if not exists public.route_cache (
  key         text primary key,
  preference  text not null check (preference in ('fastest', 'shortest')),
  km          numeric not null check (km >= 0),
  minutes     integer not null check (minutes >= 0),
  provider    text not null check (provider in ('ors', 'google')),
  created_at  timestamptz not null default now()
);

comment on table public.route_cache is
  'Trajets routiers déjà calculés (clé = préférence + coordonnées à 4 décimales). Lu avant tout appel ORS/Google.';

alter table public.route_cache enable row level security;
grant all on public.route_cache to service_role;

notify pgrst, 'reload schema';
