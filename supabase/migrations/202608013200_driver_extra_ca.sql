-- Rentabilité : CA manuel attribué à un chauffeur pour une période (courses
-- facturées directement dans Odoo, non rattachées : incentive, aftersix…).
create table if not exists public.driver_extra_ca (
  id           uuid primary key default gen_random_uuid(),
  personnel_id uuid,
  period       text,      -- AAAA-MM
  amount       numeric,   -- HTVA
  label        text,
  created_by   text,
  created_at   timestamptz default now()
);
alter table public.driver_extra_ca enable row level security;
grant all on public.driver_extra_ca to service_role;

notify pgrst, 'reload schema';
