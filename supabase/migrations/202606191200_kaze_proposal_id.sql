-- 202606191200_kaze_proposal_id.sql
-- Olivier 2026-06-19 : stocker l'id de PROPOSITION Kaze (≠ kaze_job_id).
-- L'acceptation d'une proposition Kaze se fait via l'appli web sur
-- /job_proposals/{proposal_id}/accept (la clé API ne le permet pas : 403/404).
-- Le webhook job_proposal_proposed nous envoie { job_id, proposal_id } → on
-- mémorise le proposal_id pour pouvoir accepter ensuite depuis VD Soft.

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS kaze_proposal_id text;

-- Recharger le cache de schéma PostgREST (sinon l'INSERT/UPDATE de la colonne
-- échoue silencieusement tant que le cache est stale).
NOTIFY pgrst, 'reload schema';
