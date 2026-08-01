-- Module Prestations : feuilles de présence EasyPay (une ligne par travailleur/mois).
-- La feuille du mois M+1 arrive dans le ZIP de paie du mois M, pré-remplie aux
-- heures standard. Momo marque les écarts (absences), on régénère un PDF signé.
create table if not exists public.prestation_sheets (
  id             uuid primary key default gen_random_uuid(),
  period         text not null,               -- AAAA-MM (mois CIBLE lu DANS la feuille)
  company_code   text,
  personnel_id   uuid,
  matricule      text,
  worker_name    text,
  departement    text,
  statut         text,
  qs             text,                         -- ex "38,00/38,00"
  fonction       text,
  days           jsonb default '{}'::jsonb,    -- { "1": {"h":8}, "12": {"abs":"conge"} }
  conges_jours   numeric,
  conges_heures  numeric,
  validated      boolean default false,
  validated_at   timestamptz,
  source_ref     text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (period, company_code, matricule)
);
alter table public.prestation_sheets enable row level security;
grant all on public.prestation_sheets to service_role;

notify pgrst, 'reload schema';
