-- 202608091500_saisie_dossiers_envoi
--
-- Envoi de l'état de frais + validation Parquet. Ajoute au dossier :
--   • motif de saisie (snapshot) → route le mail vers la bonne boîte SPF Justice
--   • token public de dépôt de la validation (cachet/signature renvoyés)
--   • traçage de l'envoi et de la validation reçue.
-- Olivier 2026-08-09.

ALTER TABLE saisie_dossiers
  ADD COLUMN IF NOT EXISTS motif_code          text,
  ADD COLUMN IF NOT EXISTS motif_label         text,
  ADD COLUMN IF NOT EXISTS validation_token    text,
  ADD COLUMN IF NOT EXISTS sent_to             text,
  ADD COLUMN IF NOT EXISTS sent_at             timestamptz,
  ADD COLUMN IF NOT EXISTS validation_doc_path text,
  ADD COLUMN IF NOT EXISTS validation_at       timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_saisie_dossiers_valtoken
  ON saisie_dossiers(validation_token) WHERE validation_token IS NOT NULL;

NOTIFY pgrst, 'reload schema';
