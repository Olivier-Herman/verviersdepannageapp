-- Journal des tâches de Mobi (Olivier 02/11/2026) : tout ce qu'il fait lui-même (mises en ligne, interventions en
-- séance) et tout ce que ses automatismes font (comptés chaque nuit), par date, conservé 12 mois. Sert au document
-- mensuel A4 joint à sa facture (maquette https://claude.ai/artifact/LQbVEa6GPfXt1RhvJu8reJ).
create table if not exists public.journal_mobi (
  id          uuid primary key default gen_random_uuid(),
  jour        date not null,
  at          timestamptz,
  type        text not null check (type in ('mobi', 'auto')),
  domaine     text,
  titre       text not null,
  detail      text,
  quantite    integer,
  ref         text unique,          -- dédoublonnage : git:<sha>, auto:<jour>:<catégorie>, seance:<…>
  created_at  timestamptz not null default now()
);
create index if not exists journal_mobi_jour_idx on public.journal_mobi (jour);

alter table public.journal_mobi disable row level security;
grant all on public.journal_mobi to service_role;

notify pgrst, 'reload schema';
