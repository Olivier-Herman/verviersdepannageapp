-- ============================================================
-- 202606142000_police_zone_odoo_company
-- ============================================================
-- Olivier 2026-06-14 — Relier une zone de police à une fiche Société Odoo.
--
-- Chaque zone de police peut pointer vers une société Odoo (res.partner,
-- is_company=true) dont les CONTACTS = les agents de la zone. À la création
-- d'une mission police, le chauffeur tape le nom de l'agent et on lui propose
-- les contacts de cette société (autocomplete). S'il sélectionne un contact, on
-- mémorise son id Odoo ; sinon on garde son texte libre. On ne crée jamais de
-- nouveau contact Odoo.
-- ============================================================

ALTER TABLE public.police_zones
  ADD COLUMN IF NOT EXISTS odoo_company_id INTEGER;

COMMENT ON COLUMN public.police_zones.odoo_company_id IS
  'ID de la fiche Société Odoo (res.partner) de la zone. Ses contacts = agents proposés en autocomplete au chauffeur.';

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS officer_partner_id INTEGER;

COMMENT ON COLUMN public.incoming_missions.officer_partner_id IS
  'ID Odoo (res.partner) de l''agent de police sélectionné depuis les contacts de la société de la zone. NULL si saisie libre.';

NOTIFY pgrst, 'reload schema';
