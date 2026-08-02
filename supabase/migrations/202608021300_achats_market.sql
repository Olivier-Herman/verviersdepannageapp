-- Base marché (brique 4a Achat IA) : fournisseurs/concurrents candidats par
-- catégorie d'achat, découverts par l'IA (web) ou ajoutés à la main. Toujours
-- validés par un humain avant usage (statut). Live le 2026-08-02.

create table if not exists achats_market (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text not null,
  email      text,
  phone      text,
  website    text,
  region     text,
  status     text not null default 'a_verifier',   -- a_verifier | valide | rejete
  source     text not null default 'manuel',       -- ia_web | manuel
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists achats_market_name_cat on achats_market (lower(name), category);

alter table achats_market enable row level security;
grant all on table achats_market to service_role, postgres;
notify pgrst, 'reload schema';
