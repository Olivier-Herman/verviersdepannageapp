-- ============================================================
-- Interventions sans frais
-- ============================================================
-- Cas : direction demande de ne pas facturer un dossier (ami, geste
-- commercial, etc.). Au lieu de Facturation OK / Autofacturation,
-- l'employe clique "Sans frais" et fournit un motif libre (min 4 char).
--
-- La mission passe en status='completed' comme apres facturation, mais
-- sans invoice_number / invoice_method. Elle sort de la queue facturation
-- et devient archivable J+7 apres no_charge_at.

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS no_charge_at     timestamptz,
  ADD COLUMN IF NOT EXISTS no_charge_reason text,
  ADD COLUMN IF NOT EXISTS no_charge_by     uuid REFERENCES public.users(id);

COMMENT ON COLUMN public.incoming_missions.no_charge_at     IS 'Timestamp validation "intervention sans frais". Exclusif avec invoiced_at.';
COMMENT ON COLUMN public.incoming_missions.no_charge_reason IS 'Motif libre saisi par l''employe facturation (min 4 caracteres).';
COMMENT ON COLUMN public.incoming_missions.no_charge_by     IS 'Utilisateur qui a valide la non-facturation.';

-- Re-creation de l'index archive_candidates pour inclure no_charge_at
DROP INDEX IF EXISTS public.idx_incoming_missions_archive_candidates;
CREATE INDEX idx_incoming_missions_archive_candidates
  ON public.incoming_missions(COALESCE(invoiced_at, no_charge_at))
  WHERE archived_at IS NULL
    AND status = 'completed'
    AND (invoiced_at IS NOT NULL OR no_charge_at IS NOT NULL);

-- Nouvel index pour la vue "Missions terminees" (statuts cloturees + annulees)
CREATE INDEX IF NOT EXISTS idx_incoming_missions_terminated
  ON public.incoming_missions(received_at DESC)
  WHERE archived_at IS NULL
    AND status IN ('completed', 'cancelled', 'to_invoice');
