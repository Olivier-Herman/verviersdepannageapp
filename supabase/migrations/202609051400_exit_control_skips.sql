-- 202609051400_exit_control_skips
--
-- Procédure de sortie déroulée sur le téléphone (un seul QR) : chaque étape
-- est passable avec motif + PIN personnel de celui qui a ouvert le QR.
-- skips = { "<etape>": { reason, by, by_name, at } }  (etape : path |
-- informex | identity | cmr | attestation). Olivier 2026-09-05.

alter table public.mission_exit_control
  add column if not exists skips jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
