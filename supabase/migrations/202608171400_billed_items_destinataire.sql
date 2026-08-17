-- Facture partielle : mémoriser le DESTINATAIRE de chaque poste facturé.
--
-- « Chaque facture partielle peut avoir un client différent » (Olivier
-- 2026-08-17) : l'assistance règle le dépannage pendant que le client règle son
-- parking. Sans cette colonne, l'historique du dossier dit ce qui a été facturé
-- mais plus à qui — impossible de relire un dossier six mois plus tard.
ALTER TABLE public.mission_billed_items
  ADD COLUMN IF NOT EXISTS billed_to_id   INTEGER,
  ADD COLUMN IF NOT EXISTS billed_to_name TEXT;

COMMENT ON COLUMN public.mission_billed_items.billed_to_id IS
  'res.partner Odoo facturé pour CE poste (peut différer du client de la mission).';

NOTIFY pgrst, 'reload schema';
