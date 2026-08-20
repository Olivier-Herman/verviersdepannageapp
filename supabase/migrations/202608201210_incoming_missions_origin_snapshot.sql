-- Snapshot de l'assistance d'origine, persisté sur la fiche.
--
-- Quand une fiche COMEX arrive reclassée en « Siabis non couvert » (police_snc),
-- on mémorise DUR sa source d'assistance réelle (touring) + le client à facturer
-- correspondant. Le dispatch a déjà un stash/restore mais EN MÉMOIRE React
-- (éphémère) : le chauffeur, dans une autre session, en a besoin pour l'option
-- « Ceci n'est pas un Siabis » (ex. véhicule hors autoroute → tarif Siabis non
-- applicable) → on repasse sur la source d'origine + son client, facturé à
-- l'assistance, sans encaissement client. Refonte flux sur place, 2026-08-20.

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS origin_source          text,
  ADD COLUMN IF NOT EXISTS origin_billed_to_id     bigint,
  ADD COLUMN IF NOT EXISTS origin_billed_to_name   text,
  ADD COLUMN IF NOT EXISTS origin_client_name      text,
  ADD COLUMN IF NOT EXISTS origin_client_phone     text,
  ADD COLUMN IF NOT EXISTS origin_client_address   text;

notify pgrst, 'reload schema';
