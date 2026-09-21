-- ============================================================================
-- Facturation — temps 3 « Le paiement » (Olivier 16-21/09/2026, artefact
-- HunVFDnNSQSBiK9VMhmJdu). Le statut « payée » se lit dans Odoo et ferme le
-- dossier sans clic ; relances clients J+15 / J+30 sur les factures ouvertes.
--   • incoming_missions.paid_at            : facture soldée dans Odoo (payment_state
--                                            paid / in_payment) — posé par le cron
--                                            /api/cron/facturation-paiements.
--   • incoming_missions.payment_state_odoo : dernier payment_state lu (not_paid,
--                                            partial, in_payment, paid, reversed).
--   • incoming_missions.reminder_15_at / reminder_30_at : relance courtoise /
--                                            ferme envoyée au client facturé.
--   • Réglages métier : délais des relances + interrupteur (off par défaut : les
--     textes doivent être validés par Olivier avant le premier envoi).
-- ============================================================================

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS paid_at            timestamptz,
  ADD COLUMN IF NOT EXISTS payment_state_odoo text,
  ADD COLUMN IF NOT EXISTS reminder_15_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_30_at     timestamptz;

COMMENT ON COLUMN public.incoming_missions.paid_at            IS 'Facture soldée dans Odoo (payment_state paid / in_payment). Posé par le cron facturation-paiements ; jamais par un clic.';
COMMENT ON COLUMN public.incoming_missions.payment_state_odoo IS 'Dernier account.move.payment_state lu dans Odoo (not_paid, partial, in_payment, paid, reversed).';
COMMENT ON COLUMN public.incoming_missions.reminder_15_at     IS 'Relance courtoise (J+15 après échéance) envoyée au client facturé.';
COMMENT ON COLUMN public.incoming_missions.reminder_30_at     IS 'Seconde relance, plus ferme (J+30 après échéance).';

-- Fiches facturées dont le paiement n'est pas encore constaté : le cron ne lit
-- que celles-là (bornées par invoiced_at côté code).
CREATE INDEX IF NOT EXISTS incoming_missions_paid_pending_idx
  ON public.incoming_missions (invoiced_at DESC)
  WHERE paid_at IS NULL AND (invoice_odoo_id IS NOT NULL OR invoice_number IS NOT NULL);

-- Réglages métier (registre src/lib/settings/business-registry.ts, groupe « Facturation »).
INSERT INTO app_settings (key, value, updated_at) VALUES ('relance_facture_j1_jours', '15', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('relance_facture_j2_jours', '30', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('relance_facture_mode', '"off"', now()) ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
