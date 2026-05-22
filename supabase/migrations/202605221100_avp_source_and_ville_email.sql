-- ============================================================
-- 202605221100_avp_source_and_ville_email
-- ============================================================
-- 3eme type fourriere police : les AVP (Abandon Voie Publique).
-- Workflow :
--   - Requisitionnes par la police, deposes en zone J (tampon)
--   - Bureau fourriere transfere vers D/E/F (loin des bureaux, 60j max)
--   - Tarif identique Mal Garee (PECAVP + GARDIENNAGE)
--   - Restitution conditionnee a validation police
--   - Apres 60j non recuperes : envoi en destruction (accord avec
--     Ville de Verviers, en echange des frais)
--   - Olivier traite la destruction par batch en fin de mois (pas
--     quotidiennement)
--
-- Ajouts :
--   1. Source 'police_avp' au catalog
--   2. Champ ville_destruction_email sur parc_settings : destinataire
--      du rapport de destruction mensuel envoye a la Ville de Verviers
-- ============================================================

-- 1. Source au catalog
INSERT INTO public.mission_source_catalog (key, label, sort_order)
VALUES ('police_avp', 'Police - AVP (Abandon Voie Publique)', 42)
ON CONFLICT (key) DO NOTHING;

-- 2. Email destinataire rapport destruction (config admin)
ALTER TABLE public.parc_settings
  ADD COLUMN IF NOT EXISTS ville_destruction_email TEXT;

COMMENT ON COLUMN public.parc_settings.ville_destruction_email IS
  'Email destinataire du rapport mensuel d envoi en destruction (Ville de Verviers, accord AVP).';
