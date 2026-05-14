-- ============================================================
-- Client par defaut par source
-- ============================================================
-- Permet d'auto-completer le champ "client facture" sur les missions
-- entrantes selon leur source (ex: Ethias → Ethias SA, Vivium → Vivium SA).
-- Le dispatcher peut toujours modifier manuellement par la suite.

ALTER TABLE public.mission_source_catalog
  ADD COLUMN IF NOT EXISTS default_billed_to_id   integer,
  ADD COLUMN IF NOT EXISTS default_billed_to_name text;

COMMENT ON COLUMN public.mission_source_catalog.default_billed_to_id   IS
  'Odoo partner_id du client a facturer par defaut pour cette source. NULL = pas de default.';
COMMENT ON COLUMN public.mission_source_catalog.default_billed_to_name IS
  'Nom affiche du client par defaut (cache local du nom Odoo pour eviter les lookups).';
