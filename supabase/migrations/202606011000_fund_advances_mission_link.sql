-- Olivier 2026-06-01 : permet de lier une avance de fonds a une mission.
--
-- Cas d usage : le chauffeur fait une avance pendant une mission (achat
-- piece, carburant, peage, etc.). Le bouton "Avance de fonds" du menu
-- action de la fiche mission ouvre le wizard /avance-fonds avec
-- mission_id pre-rempli. Au moment de la facturation, la ligne sera
-- ajoutee au devis Odoo avec le PDF lie.
--
-- mission_id NULL = avance standalone (cas historique + cas direct
-- depuis /avance-fonds sans mission de reference).

ALTER TABLE public.fund_advances
  ADD COLUMN IF NOT EXISTS mission_id UUID
    REFERENCES public.incoming_missions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fund_advances_mission_id
  ON public.fund_advances(mission_id)
  WHERE mission_id IS NOT NULL;

COMMENT ON COLUMN public.fund_advances.mission_id IS
  'Lien optionnel vers la mission a laquelle l avance se rattache. Permet l ajout auto de la ligne dans le devis Odoo + highlight de la carte facturation. NULL = avance standalone. Olivier 2026-06-01.';

NOTIFY pgrst, 'reload schema';
