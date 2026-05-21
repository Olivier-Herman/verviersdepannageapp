-- ============================================================
-- 202605211000_mal_garee_source_and_fields
-- ============================================================
-- Foundation pour le module Fourriere Police, premiere etape :
-- les Mal Garees (reqisitions police pour mauvais stationnement).
--
-- Ajouts :
--   1. Source "police_mg" au catalog (Mal Garee)
--   2. Champ police_blocked (BOOLEAN) sur incoming_missions :
--      certaines missions Mal Garee sont "bloquees" par le policier
--      qui exige que le proprietaire se presente au commissariat
--      avant de pouvoir recuperer son vehicule. La restitution
--      est alors conditionnelle a la verification (modal "Le
--      proprietaire est-il passe a la police ?").
--   3. Champ payment_breakdown (JSONB) sur incoming_missions :
--      stocke les modes de paiement utilises (multi-modes possibles,
--      ex: 100 EUR espece + 65 EUR Bancontact). Format :
--      [{ "mode": "cash" | "bancontact" | "driver_encaissement",
--         "amount": number_eur,
--         "driver_id": uuid? (si driver_encaissement) }]
--      Cette info est utilisee pour generer la note Odoo sur le devis
--      ("Paye par : ...").
-- ============================================================

-- 1. Source au catalog
INSERT INTO public.mission_source_catalog (key, label, sort_order)
VALUES ('police_mg', 'Police - Mal Garée', 40)
ON CONFLICT (key) DO NOTHING;

-- 2. Champs sur incoming_missions
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS police_blocked    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payment_breakdown JSONB;

COMMENT ON COLUMN public.incoming_missions.police_blocked IS
  'Mission Mal Garee bloquee par le policier : le proprietaire doit etre passe au commissariat avant la restitution. UI affiche modal de verif.';
COMMENT ON COLUMN public.incoming_missions.payment_breakdown IS
  'Detail des paiements a la restitution (multi-modes). Format JSONB array [{mode, amount, driver_id?}]. Genere la note Odoo "Paye par ..." sur le devis.';

-- Index partial pour rapidement lister les missions bloquees
CREATE INDEX IF NOT EXISTS idx_incoming_missions_police_blocked
  ON public.incoming_missions (police_blocked)
  WHERE police_blocked = TRUE;
