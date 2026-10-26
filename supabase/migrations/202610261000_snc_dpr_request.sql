-- SNC : « client parti » = déplacement pour rien (Olivier 26/10/2026). Pas de paiement, la mission est annulée.
-- Le chauffeur DEMANDE depuis la fiche ; le dispatch valide dans un popup obligatoire, signé par son code PIN
-- (même mécanique que la demande de passage en Siabis couvert). Trace sur la fiche.
alter table public.incoming_missions
  add column if not exists snc_dpr_requested_at timestamptz,
  add column if not exists snc_dpr_requested_by uuid,
  add column if not exists snc_dpr_decision text,
  add column if not exists snc_dpr_decided_at timestamptz,
  add column if not exists snc_dpr_decided_by uuid;
notify pgrst, 'reload schema';
