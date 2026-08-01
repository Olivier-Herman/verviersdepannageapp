-- Module Gestion du Personnel / Paie.
-- Répertoire du personnel (couvre TOUS les employés, même sans compte app) +
-- fiches de paie découpées par travailleur. Données sensibles → RLS ON,
-- accès service_role uniquement (le navigateur passe par des API gatées).

create table if not exists public.personnel (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,             -- nom complet (tel qu'affiché)
  name_key     text,                      -- clé normalisée (matching fiche → personne)
  company_code text,                      -- '438' (Verviers Dépannage) / '3068' (DGJ VHU)
  matricule    text,                      -- matricule EasyPay si connu
  user_id      uuid references public.users(id) on delete set null,  -- compte app lié (optionnel)
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists idx_personnel_namekey on public.personnel (name_key);
create index if not exists idx_personnel_user    on public.personnel (user_id);

create table if not exists public.payslips (
  id            uuid primary key default gen_random_uuid(),
  personnel_id  uuid references public.personnel(id) on delete set null,
  worker_name   text,                      -- nom lu sur la fiche
  period        text,                      -- 'AAAA-MM'
  company_code  text,
  pages         int,
  pdf_b64       text,                      -- PDF de la fiche (base64)
  source        text,                      -- 'mail' | 'upload'
  source_ref    text,                      -- id message mail / nom fichier
  created_at    timestamptz not null default now(),
  unique (personnel_id, period, company_code)
);
create index if not exists idx_payslips_period    on public.payslips (period);
create index if not exists idx_payslips_personnel on public.payslips (personnel_id);

alter table public.personnel enable row level security;
alter table public.payslips  enable row level security;
grant all on public.personnel to service_role;
grant all on public.payslips  to service_role;

notify pgrst, 'reload schema';
