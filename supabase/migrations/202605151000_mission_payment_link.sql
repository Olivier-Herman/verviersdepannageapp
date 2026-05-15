-- ============================================================
-- 202605151000_mission_payment_link
-- ============================================================
-- Lie un encaissement chauffeur a la mission qui l'a declenche, et
-- annote la mission avec le statut de paiement (Payee / Facture a envoyer).
--
-- Cas d'usage : dispatcher encode une mission avec amount_to_collect.
-- Le chauffeur clique "Encaissement" → ouvre /encaissement?prefill_mission_id=...
-- A la sauvegarde, l'intervention est liee a la mission via mission_id, et
-- la mission est annotee avec payment_collected_at + payment_mode.
--
-- Cote affichage :
--   - payment_mode === 'unpaid' → "📄 Facture a envoyer"
--   - payment_mode !== 'unpaid' (cash/bancontact/sumup/etc) → "✅ Payee"
--   - payment_collected_at IS NULL → rien (pas encore encaisse)
--
-- Standalone (sans mission_id) : aucun impact, comportement inchange.
-- ============================================================

-- 1. FK interventions.mission_id → incoming_missions.id
ALTER TABLE public.interventions
ADD COLUMN IF NOT EXISTS mission_id UUID REFERENCES public.incoming_missions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_interventions_mission_id
  ON public.interventions(mission_id)
  WHERE mission_id IS NOT NULL;

COMMENT ON COLUMN public.interventions.mission_id IS
  'Mission qui a declenche cet encaissement (NULL si encaissement standalone, ex: client passage caisse).';

-- 2. Annotation paiement sur la mission
ALTER TABLE public.incoming_missions
ADD COLUMN IF NOT EXISTS payment_collected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS payment_mode         TEXT;

COMMENT ON COLUMN public.incoming_missions.payment_collected_at IS
  'Quand le chauffeur a finalise l''encaissement de cette mission (NULL = pas encore encaisse).';
COMMENT ON COLUMN public.incoming_missions.payment_mode IS
  'Mode de paiement utilise par le chauffeur (cash, bancontact, sumup, unpaid=A facturer, etc.).';
