-- 202609031200_saisie_liquidation_forclusion
--
-- Automatisation du cycle Parquet (Olivier 2026-09-03) :
--   • liquidation : le mail « Dossier NNNNNN-26 – Changement de statut » du bureau
--     de taxation (fourriere@) fait passer l'état de frais déposé → liquidé, puis
--     la facture Odoo est créée toute seule ;
--   • relance du Parquet sur les états de frais sans retour ;
--   • forclusion : 6 mois à dater de la prestation (AR 15/12/2019 art. 41) ;
--   • dédup des mails traités (liquidation + retours signés).

ALTER TABLE saisie_etats_frais
  ADD COLUMN IF NOT EXISTS liquide_at             timestamptz,
  ADD COLUMN IF NOT EXISTS status_note            text,
  ADD COLUMN IF NOT EXISTS justinvoice_detail_url text,
  ADD COLUMN IF NOT EXISTS relance_count          int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_relance_at        timestamptz,
  ADD COLUMN IF NOT EXISTS relance_stop           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS forclusion_alert_level int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_saisie_ef_justinvoice_ref ON saisie_etats_frais(justinvoice_ref);
CREATE INDEX IF NOT EXISTS idx_saisie_ef_status          ON saisie_etats_frais(status);

-- Mails de la boîte fourrière déjà traités par la veille saisie (dédup).
CREATE TABLE IF NOT EXISTS saisie_mail_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox         text NOT NULL,
  source_email_id text NOT NULL UNIQUE,
  kind            text NOT NULL,            -- liquidation | statut | retour_signe | ignore
  ref             text,                     -- n° dossier JustInvoice ou n° EDF
  subject         text,
  from_addr       text,
  received_at     timestamptz,
  ef_id           uuid REFERENCES saisie_etats_frais(id) ON DELETE SET NULL,
  outcome         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saisie_mail_events_kind ON saisie_mail_events(kind, created_at DESC);
ALTER TABLE saisie_mail_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON saisie_mail_events TO service_role;

NOTIFY pgrst, 'reload schema';
