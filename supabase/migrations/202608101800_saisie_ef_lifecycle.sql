-- 202608101800_saisie_ef_lifecycle
--
-- Chaque ÉTAT DE FRAIS a son propre cycle (un dossier peut en avoir plusieurs en
-- vol : gardiennage récurrent pendant l'attente). On facture l'état de frais
-- qu'on SCANNE, pas « le dernier ». Le cycle accord→dépôt→facture appartient donc
-- à la ligne saisie_etats_frais, identifiée par son n° EDF au scan. Olivier 2026-08-10.

ALTER TABLE saisie_etats_frais
  ADD COLUMN IF NOT EXISTS status              text NOT NULL DEFAULT 'envoye', -- envoye|accepte|refuse|depose|facture
  ADD COLUMN IF NOT EXISTS validation_doc_path text,
  ADD COLUMN IF NOT EXISTS validation_at       timestamptz,
  ADD COLUMN IF NOT EXISTS justinvoice_ref     text,
  ADD COLUMN IF NOT EXISTS odoo_invoice_id     integer;

CREATE INDEX IF NOT EXISTS idx_saisie_ef_numero ON saisie_etats_frais(numero);

NOTIFY pgrst, 'reload schema';
