-- Écran client face-comptoir : mode « lecture eID → création client ».
-- Prolonge public.customer_display (202607281200) avec le CANAL RETOUR écran→fiche.
--
-- Le mode et l'identifiant de requête (request_id) voyagent DANS payload
--   (payload = { mode:'eid', request_id, step:'consent'|'done', ... }).
-- La réponse du client (Nom/Prénom/Adresse lus + email/tél saisis) est écrite
--   par le kiosque (via la route serveur en service_role) dans response/response_at,
--   colonnes SÉPARÉES pour ne pas écraser payload et pour que la fiche opérateur
--   la reçoive en realtime sans collision.

alter table public.customer_display
  add column if not exists response    jsonb,        -- données client renvoyées (eID + email/tél)
  add column if not exists response_at timestamptz;  -- horodatage du renvoi (corrélation fiche)

-- Recharge le cache de schéma PostgREST (sinon INSERT/SELECT des colonnes = KO silencieux).
notify pgrst, 'reload schema';
