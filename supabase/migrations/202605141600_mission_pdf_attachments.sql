-- ============================================================
-- Tracking attachements PDF mission vers Odoo
-- ============================================================
-- Quand une mission est cloturee (DSP ou REM), un PDF resume est genere
-- et attache a 3 cibles Odoo :
--   1. helpdesk.ticket (fiche assistance) → toujours si odoo_helpdesk_id present
--   2. fleet.vehicle   (historique vehicule) → toujours si odoo_vehicle_id present
--   3. account.move    (facture, brouillon ou postee) → seulement si invoice_odoo_id present
--
-- L'attachement est fire-and-forget cote API routes (pour ne pas bloquer le
-- driver-action). Un cron quotidien re-essaie les failed (pdf_attach_attempts
-- < 5 et au moins un slot non rempli).
--
-- Chain REM+REL : si meme client + meme invoice_number, le PDF combine
-- est genere une fois et attache au compte de la mission "parent" (REM).
-- Le slot pdf_attached_invoice_at sur les 2 reflete l'attachement combine.

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS pdf_attached_helpdesk_at timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_attached_vehicle_at  timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_attached_invoice_at  timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_attach_attempts      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pdf_last_error           text;

COMMENT ON COLUMN public.incoming_missions.pdf_attached_helpdesk_at IS 'Timestamp attachement PDF mission sur helpdesk.ticket Odoo.';
COMMENT ON COLUMN public.incoming_missions.pdf_attached_vehicle_at  IS 'Timestamp attachement PDF mission sur fleet.vehicle Odoo.';
COMMENT ON COLUMN public.incoming_missions.pdf_attached_invoice_at  IS 'Timestamp attachement PDF mission sur account.move (facture Odoo). Seulement si invoice_odoo_id rempli.';
COMMENT ON COLUMN public.incoming_missions.pdf_attach_attempts      IS 'Nombre de tentatives cumulees (success + fail). Cron retry stops at 5.';
COMMENT ON COLUMN public.incoming_missions.pdf_last_error           IS 'Dernier message d''erreur (ex: cible Odoo indisponible). Reset a NULL sur succes complet.';

-- Index pour le cron retry : missions completed avec attachement(s) manquant(s)
CREATE INDEX IF NOT EXISTS idx_missions_pdf_attach_pending
  ON public.incoming_missions(updated_at DESC)
  WHERE archived_at IS NULL
    AND status = 'completed'
    AND pdf_attach_attempts < 5
    AND (
      (odoo_helpdesk_id IS NOT NULL AND pdf_attached_helpdesk_at IS NULL) OR
      (odoo_vehicle_id  IS NOT NULL AND pdf_attached_vehicle_at  IS NULL) OR
      (invoice_odoo_id  IS NOT NULL AND pdf_attached_invoice_at  IS NULL)
    );
