-- Restitution : décision sur chaque facture du dossier encore ouverte (Olivier 30/09/2026 :
-- « s'il reste des choses à payer, il faut absolument les afficher pour qu'on puisse
-- décider ce qu'on fait des montants ouverts »).
-- { "<id facture Odoo>": { "decision": "later", "by": uuid, "by_name": text, "at": iso } }
ALTER TABLE public.restitutions ADD COLUMN IF NOT EXISTS open_decisions jsonb;
notify pgrst, 'reload schema';
