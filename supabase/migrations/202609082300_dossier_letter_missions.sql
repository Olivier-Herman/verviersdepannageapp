-- D4 (audit facturation, Olivier 08/09/2026) : la lettre d'un groupe est figée
-- à sa première apparition, parce qu'elle est imprimée sur la facture Odoo.
ALTER TABLE public.incoming_missions ADD COLUMN IF NOT EXISTS dossier_letter text;
NOTIFY pgrst, 'reload schema';
