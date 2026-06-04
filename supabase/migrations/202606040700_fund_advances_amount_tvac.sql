-- src/supabase/migrations/202606040700_fund_advances_amount_tvac.sql
--
-- Olivier 2026-06-04 : ajoute amount_tvac aux avances de fonds.
-- amount_htva = sert au PU des lignes de facturation Odoo (existant)
-- amount_tvac = sert au mouvement caisse chauffeur (nouveau, jusqu ici
--               estime via TVA standard 21% mais en realite parfois 6% ou
--               12% selon le type de bien achete)
--
-- L OCR de la facture (Claude Vision) extrait les 2 montants directement
-- depuis la photo/PDF de la facture du fournisseur.

ALTER TABLE public.fund_advances
  ADD COLUMN IF NOT EXISTS amount_tvac NUMERIC;

COMMENT ON COLUMN public.fund_advances.amount_tvac IS
  'Montant TTC (TVAC) extrait de la facture par OCR ou saisi manuellement. '
  'Utilise pour le mouvement caisse chauffeur. amount_htva (existant) sert '
  'au PU des lignes de facturation Odoo.';

NOTIFY pgrst, 'reload schema';
