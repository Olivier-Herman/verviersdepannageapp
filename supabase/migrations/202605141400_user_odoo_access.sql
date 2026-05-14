-- ============================================================
-- Acces Odoo par utilisateur — Phase A
-- ============================================================
-- Permet de gater le bouton "Ouvrir dans Odoo" sur les sheets in-app
-- (VehicleSheet, InvoiceSheet, etc.). Les users sans acces verront uniquement
-- le contenu rendu dans l'app, sans porte de sortie vers Odoo.
--
-- Phase B (ulterieure) : ajoutera odoo_api_key + odoo_uid pour que les writes
-- Odoo declenches depuis l'app soient signes par l'utilisateur reel.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS has_odoo_access boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS odoo_api_key    text,
  ADD COLUMN IF NOT EXISTS odoo_uid        integer;

COMMENT ON COLUMN public.users.has_odoo_access IS 'Si true : bouton "Ouvrir dans Odoo" visible sur les sheets. Phase A = gere a la main par admin. Phase B = derive automatique si odoo_api_key/odoo_uid presents.';
COMMENT ON COLUMN public.users.odoo_api_key    IS 'Cle API Odoo personnelle (chiffree cote serveur, jamais retournee a l''UI). Permet d''attribuer les writes Odoo au vrai utilisateur. NULL = utilise la cle maitre.';
COMMENT ON COLUMN public.users.odoo_uid        IS 'UID Odoo de l''utilisateur (res.users.id). Necessaire avec odoo_api_key pour les calls authentifies.';
