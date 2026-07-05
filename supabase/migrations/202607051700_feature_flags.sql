-- Feature flags / mode preview. Permet à un superadmin d'activer une nouvelle
-- vue (ex. fiche dossier unifiée) pour lui seul (mode 'superadmin') avant de la
-- généraliser à tout le monde (mode 'all'), sans impacter la prod.
--   mode = 'off'        → personne (prod inchangée)
--   mode = 'superadmin' → visible uniquement pour les superadmins (preview)
--   mode = 'all'        → tout le monde (version finale)
create table if not exists public.feature_flags (
  key        text primary key,
  mode       text not null default 'off' check (mode in ('off','superadmin','all')),
  label      text,
  updated_at timestamptz not null default now()
);

-- Table serveur-only (lue côté serveur via service_role).
alter table public.feature_flags enable row level security;
grant all on public.feature_flags to service_role;

-- Flag du 1er chantier : fiche dossier unifiée (REM · Parc · REL).
insert into public.feature_flags (key, mode, label)
values ('dossier_view', 'off', 'Fiche dossier unifiée (REM · Parc · REL)')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
