-- Olivier 2026-06-02 PM : tarif special HTVA pour les missions hors cadre.
-- Quand le dispatcher convient d un prix specifique avec le client/assistance
-- (intervention atypique, conditions particulieres), il saisit ce montant
-- qui ECRASE le calcul automatique. Lors de la facturation, on push UNE
-- SEULE ligne SERV-DIV "Intervention suivant prix convenu" au lieu des
-- lignes calculees.
--
-- Visible UNIQUEMENT cote dispatch + facturation (highlight visible).
-- INVISIBLE cote chauffeur (ce n est pas un encaissement client).

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS special_tarif_htva NUMERIC(10,2);

COMMENT ON COLUMN public.incoming_missions.special_tarif_htva IS
  'Tarif special HTVA convenu hors cadre. Si renseigne, ecrase le calcul automatique. Genere une ligne SERV-DIV "Intervention suivant prix convenu" a la facturation.';

NOTIFY pgrst, 'reload schema';
