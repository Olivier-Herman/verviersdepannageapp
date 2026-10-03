-- Question de fin de conversation quand le chauffeur clôture la mission
-- (Olivier 03/10/2026) : « Je peux clôturer notre conversation ? ».
alter table public.sam_state add column if not exists question jsonb;
alter table public.sam_conversations drop constraint if exists sam_conversations_end_reason_check;
alter table public.sam_conversations add constraint sam_conversations_end_reason_check
  check (end_reason in ('inactivite', 'action', 'releve', 'mission_cloturee'));
notify pgrst, 'reload schema';
