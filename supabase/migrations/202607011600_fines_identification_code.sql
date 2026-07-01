-- 202607011600_fines_identification_code.sql
-- Code d'identification figurant sur le PV (distinct du n° de PV) : lu par OCR,
-- affiché sur la carte de l'amende. Olivier 2026-07-01.

alter table public.fines add column if not exists identification_code text;

comment on column public.fines.identification_code is
  'Code d''identification figurant sur le PV (ex. communication de paiement / code de perception), distinct du n° de PV (infraction_ref).';

notify pgrst, 'reload schema';
