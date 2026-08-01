-- Phase 2 Prestations : traçabilité de la validation/signature (par PIN).
alter table public.prestation_sheets add column if not exists signed_by text;

notify pgrst, 'reload schema';
