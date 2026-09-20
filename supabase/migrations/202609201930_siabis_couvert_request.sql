-- Demande de passage en Siabis couvert (Olivier 20/09/2026) : depuis une fiche
-- non couverte, le chauffeur DEMANDE ; le dispatch confirme ou refuse via un
-- popup obligatoire. Trace sur la fiche (jamais de bascule directe chauffeur).
alter table public.incoming_missions
  add column if not exists siabis_couvert_requested_at timestamptz,
  add column if not exists siabis_couvert_requested_by uuid,
  add column if not exists siabis_couvert_decision text,
  add column if not exists siabis_couvert_decided_at timestamptz,
  add column if not exists siabis_couvert_decided_by uuid;
notify pgrst, 'reload schema';
