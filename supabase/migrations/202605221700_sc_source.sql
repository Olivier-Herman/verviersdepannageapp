-- ============================================================
-- 202605221700_sc_source
-- ============================================================
-- Ajoute la source 'sia_couvert' (SC = Siabis Couvert) au catalog.
--
-- SC est une intervention sur autoroute (comme SNC) MAIS le vehicule est
-- couvert par un contrat d assistance (Touring, Ethias, VAB, IMA, etc.).
-- L assistance paye, pas le client.
--
-- Tarif : meme que SNC mais SANS les kilometres (forfait uniquement).
--   - SIAREM forfait + SIABAL si balisage
--   - Pas de SIAKIL (ni en normal ni en MAJ)
--   - Bascule MAJ identique selon plages horaires
--
-- Scenarios :
--   - dsp        : depannage sur place, pas de gestion d epot, facture assistance
--   - rem_depot  : remorquage vers Pepinster, zone Transit, relivraison ulterieure
--                  au tarif assistance (mission REL distincte)
--   - rem_client : N A si SC (assistance reprend, jamais paiement immediat)
-- ============================================================

INSERT INTO public.mission_source_catalog (key, label, sort_order)
VALUES ('sia_couvert', 'Siabis Couvert (assistance)', 36)
ON CONFLICT (key) DO NOTHING;
