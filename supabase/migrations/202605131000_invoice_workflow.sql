-- ============================================================
-- Workflow facturation — Phase 1
-- ============================================================
-- Quand le chauffeur termine une mission (DSP completed, REM complete_delivery,
-- REL livree, REM mise en parc puis REL creee), au lieu de passer directement
-- en 'completed', la mission passe en 'to_invoice'. L'employe facturation
-- valide manuellement (avec numero de facture Odoo) ou via auto-facturation
-- (compagnie qui valide elle-meme), puis la mission passe en 'completed' final.
--
-- Un cron resout l'URL directe de la facture Odoo a partir du numero saisi.

-- 1) Module 'facturation' ----------------------------------------------------

INSERT INTO public.modules (id, label, description, icon, sort_order, active)
VALUES ('facturation', 'Facturation', 'Validation des factures et auto-facturations', '🧾', 70, true)
ON CONFLICT (id) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      icon        = EXCLUDED.icon,
      active      = true;

-- Rattrapage : module 'relances' a ete utilise sans avoir ete insere
INSERT INTO public.modules (id, label, description, icon, sort_order, active)
VALUES ('relances', 'Relances', 'Relances clients sur factures impayees', '📬', 65, true)
ON CONFLICT (id) DO NOTHING;

-- 2) Colonnes facturation sur incoming_missions ------------------------------

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS invoice_method  text,
  ADD COLUMN IF NOT EXISTS invoice_number  text,
  ADD COLUMN IF NOT EXISTS invoice_odoo_id integer,
  ADD COLUMN IF NOT EXISTS invoice_url     text,
  ADD COLUMN IF NOT EXISTS invoiced_at     timestamptz,
  ADD COLUMN IF NOT EXISTS invoiced_by     uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS invoice_notes   text;

COMMENT ON COLUMN public.incoming_missions.invoice_method  IS 'manual = facture saisie par employe / auto = autofacturee par compagnie (Touring, etc.)';
COMMENT ON COLUMN public.incoming_missions.invoice_number  IS 'Numero facture Odoo (ex: INV/2025/00123). NULL si autofacturation.';
COMMENT ON COLUMN public.incoming_missions.invoice_odoo_id IS 'account.move.id Odoo, resolu par cron a partir du numero.';
COMMENT ON COLUMN public.incoming_missions.invoice_url     IS 'Lien direct vers la facture dans Odoo, rempli par cron sync-invoice-urls.';

-- 3) Index pour la page facturation et le cron -------------------------------

-- Index pour liste rapide des missions a facturer
CREATE INDEX IF NOT EXISTS idx_missions_to_invoice
  ON public.incoming_missions(status, received_at DESC)
  WHERE status = 'to_invoice';

-- Index pour cron de resolution URL (numero saisi mais URL pas encore resolue)
CREATE INDEX IF NOT EXISTS idx_missions_invoice_url_pending
  ON public.incoming_missions(invoice_number)
  WHERE invoice_number IS NOT NULL AND invoice_url IS NULL;

-- 4) Verification statut ----------------------------------------------------
-- Ajouter 'to_invoice' au check constraint s'il existe (sinon noop)
-- Note: si pas de check, l'enum est libre cote postgres, c'est le type TS qui contraint.

DO $$
BEGIN
  -- Pas de drop si pas existant. On suppose que la colonne 'status' est text libre.
  -- Aucune action SQL necessaire ici, la contrainte est cote app.
  RAISE NOTICE 'Statut to_invoice ajoute (contrainte applicative, pas de check SQL a modifier)';
END $$;

-- 5) GRANT pour service_role ------------------------------------------------
-- Pas necessaire : les ALTER TABLE preservent les grants existants sur la table.

-- 6) Pas de backfill --------------------------------------------------------
-- Les missions actuellement en 'completed' restent telles quelles (historique).
-- Seules les nouvelles cloturees apres deploiement passeront par 'to_invoice'.
