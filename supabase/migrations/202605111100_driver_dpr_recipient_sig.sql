-- ============================================================
-- Driver app — colonnes pour DPR motif type + signature destinataire REM
-- ============================================================
-- Suite a l'evolution app chauffeur du 11/05/2026 :
--   - DPR avec motif type (7 motifs preset + texte libre "autre")
--   - Refus de prise en charge REM avant chargement -> conversion DPR
--   - Signature destinataire REM optionnelle a la depose
--
-- Ces 4 colonnes sont peuplees a la cloture via /api/missions/driver-action
-- closing_data.dpr_motif / dpr_motif_label / dpr_converted_from_rem /
-- recipient_signature.

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS dpr_motif              text,
  ADD COLUMN IF NOT EXISTS dpr_motif_label        text,
  ADD COLUMN IF NOT EXISTS dpr_converted_from_rem boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS recipient_signature    text;

COMMENT ON COLUMN public.incoming_missions.dpr_motif IS
  'Id du motif DPR (vehicule_absent, refus_proprio, acces_impossible, deja_deplace, pas_de_panne, annulation_client, autre)';
COMMENT ON COLUMN public.incoming_missions.dpr_motif_label IS
  'Libelle human-readable du motif DPR (ou texte libre si motif=autre)';
COMMENT ON COLUMN public.incoming_missions.dpr_converted_from_rem IS
  'TRUE si la cloture en DPR provient d un refus de prise en charge sur une mission REM (avant chargement)';
COMMENT ON COLUMN public.incoming_missions.recipient_signature IS
  'Signature destinataire (REM uniquement) - data URL base64 image';

-- Verification :
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='incoming_missions'
-- AND column_name IN ('dpr_motif', 'dpr_motif_label', 'dpr_converted_from_rem', 'recipient_signature');
