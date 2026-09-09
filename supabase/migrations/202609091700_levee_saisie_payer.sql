-- Qui paie après une levée de saisie ? (Olivier 09/09/2026)
--
-- Jusqu'ici la vue dossier DÉDUISAIT la réponse du client facturé, et se
-- trompait quand personne ne l'avait encore encodé : un dossier judiciaire
-- basculait vers une facture Odoo au client alors qu'il doit continuer en état
-- de frais. La levée pose donc la question, et la réponse est stockée :
--
--   'frais_justice' → Frais de Justice Verviers (id Odoo 67). Le dossier reste
--                     dans le circuit état de frais, la levée en est la fin.
--   'client'        → le client paie les frais : facture Odoo, et le
--                     gardiennage postérieur passe au tarif « autre ».
--
-- Null = levée enregistrée avant cette question : la vue dossier retombe alors
-- sur son ancienne déduction (client facturé = Frais de Justice).

ALTER TABLE incoming_missions
  ADD COLUMN IF NOT EXISTS levee_saisie_payer text
    CHECK (levee_saisie_payer IN ('frais_justice', 'client'));

COMMENT ON COLUMN incoming_missions.levee_saisie_payer IS
  'Qui paie après la levée de saisie : frais_justice (état de frais, SPF Justice) ou client (facture Odoo). Null = levée antérieure à la question.';

NOTIFY pgrst, 'reload schema';
