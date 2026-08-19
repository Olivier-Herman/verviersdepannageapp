-- Abandon volontaire de véhicule (Olivier 2026-08-19).
--
-- Le client laisse son véhicule (souvent accidenté) à Verviers Dépannage. On
-- imprimait jusqu'ici un Word retapé à la main : identité, adresse, véhicule.
-- La fiche connaît déjà le véhicule et la carte d'identité donne le reste — le
-- document se génère donc depuis la fiche, et l'accord se garde AVEC elle.
--
-- storage_waived : la contrepartie habituelle de l'abandon, « en échange des
-- frais de gardiennage ». Le gardiennage n'est pas une colonne mais un calcul
-- (parked_at → sortie) : sans ce drapeau, il continuerait de courir sur un
-- véhicule qui ne sortira jamais. Coché = le calcul rend zéro.
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS abandon_data    JSONB,
  ADD COLUMN IF NOT EXISTS abandon_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS storage_waived  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.incoming_missions.abandon_data IS
  'Abandon volontaire : identité du cédant (eID ou saisie), adresse, snapshot véhicule, signature, contrepartie.';
COMMENT ON COLUMN public.incoming_missions.abandon_at IS
  'Horodatage de l''abandon volontaire (null = pas d''abandon).';
COMMENT ON COLUMN public.incoming_missions.storage_waived IS
  'Frais de gardiennage abandonnés (contrepartie de l''abandon) → estimation et devis rendent 0 pour le parc.';

NOTIFY pgrst, 'reload schema';
