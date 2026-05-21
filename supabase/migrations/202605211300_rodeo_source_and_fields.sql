-- ============================================================
-- 202605211300_rodeo_source_and_fields
-- ============================================================
-- 2eme type fourriere police : les Rodeos.
-- Workflow : meme principe que Mal Garees, sauf 2 differences :
--   - Minimum 3 jours de gardiennage facturable (meme si recupere dans les 24h)
--   - Passage obligatoire chez la police avec document "Levee de saisie"
--     a presenter avant restitution
--
-- Ajouts :
--   1. Source "police_rodeo" au catalog
--   2. police_levee_saisie_ok      : la levee de saisie a ete validee/recue ?
--      (toggle obligatoire pour pouvoir restituer un Rodeo)
--   3. police_levee_saisie_doc_url : URL de la photo du document de levee
--      (optionnel, simple trace dans la fiche)
-- ============================================================

-- 1. Source au catalog
INSERT INTO public.mission_source_catalog (key, label, sort_order)
VALUES ('police_rodeo', 'Police - Rodéo', 41)
ON CONFLICT (key) DO NOTHING;

-- 2. Champs sur incoming_missions
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS police_levee_saisie_ok      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS police_levee_saisie_doc_url TEXT;

COMMENT ON COLUMN public.incoming_missions.police_levee_saisie_ok IS
  'Rodeo uniquement : la levee de saisie a ete obtenue/validee. Obligatoire pour pouvoir restituer le vehicule.';
COMMENT ON COLUMN public.incoming_missions.police_levee_saisie_doc_url IS
  'Rodeo uniquement : URL de la photo du document de levee de saisie (optionnel).';
