-- Pause et transfert d'une mission par le chauffeur (Olivier 18/10/2026, maquette validée).
-- Pause : « Je reviens plus tard » — la mission reste ouverte, le chauffeur redevient libre,
-- rappel à l'heure prévue (+15 min : relance puis dispatch).
-- Transfert : le chauffeur A propose sa mission au chauffeur B (après l'avoir appelé) ; elle ne
-- passe à B qu'à son acceptation. 5 min sans réponse : appel automatique à B.
alter table incoming_missions
  add column if not exists paused_at            timestamptz,
  add column if not exists pause_until          timestamptz,
  add column if not exists pause_reason         text,
  add column if not exists pause_reminded_at    timestamptz,
  add column if not exists pause_relance_at     timestamptz,
  add column if not exists pause_total_seconds  integer not null default 0,
  add column if not exists transfer_to          uuid,
  add column if not exists transfer_from        uuid,
  add column if not exists transfer_reason      text,
  add column if not exists transfer_requested_at timestamptz,
  add column if not exists transfer_call_at     timestamptz;
create index if not exists incoming_missions_paused on incoming_missions (pause_until) where paused_at is not null;
create index if not exists incoming_missions_transfer_to on incoming_missions (transfer_to) where transfer_to is not null;
notify pgrst, 'reload schema';
