-- ============================================================
-- 202605151200_payment_derogations
-- ============================================================
-- Workflow derogation paiement : chauffeur bloque par un client qui refuse
-- de payer (voiture non demarree, prestation contestee, etc) declenche une
-- demande au dispatcher de garde, qui peut :
--   - annuler le montant (amount_to_collect = 0)
--   - ajuster a un nouveau montant
--   - refuser la demande (le chauffeur doit encaisser le total prevu)
--
-- Cote UX chauffeur : bouton cache derriere 5 taps sur la banderole rouge
-- "A encaisser" (pas de bouton visible dans l ecran mission). Briefing
-- vocal a l equipe.
--
-- Cote UX dispatcher : encart en haut de /dispatch/<id> si demande pending,
-- 3 boutons decision (notif push au chauffeur a la decision).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_derogations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mission_id      UUID NOT NULL REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  requested_by    UUID NOT NULL REFERENCES public.users(id),
  requested_at    TIMESTAMPTZ DEFAULT NOW(),
  motive          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'cancelled_amount', 'adjusted', 'refused')),
  new_amount      NUMERIC(10,2),  -- utilise si status = 'adjusted'
  decided_by      UUID REFERENCES public.users(id),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour retrouver rapidement la demande pending d une mission
CREATE INDEX IF NOT EXISTS idx_payment_derogations_mission_pending
  ON public.payment_derogations(mission_id)
  WHERE status = 'pending';

-- RLS : disable + grant service_role (l API utilise createAdminClient)
ALTER TABLE public.payment_derogations DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.payment_derogations TO service_role;

COMMENT ON TABLE public.payment_derogations IS
  'Demandes de derogation paiement (chauffeur bloque par client qui refuse de payer) — workflow validation par dispatcher de garde.';
