-- Suivi des rapprochements de versements Paynovate / SumUp.
--
-- Une ligne par versement traité. Sert à trois choses :
--   1. IDEMPOTENCE — un versement déjà rapproché ne peut plus l'être, même si
--      le cron repasse dessus (contrainte unique sur payout_ref).
--   2. TRAÇABILITÉ — qui a validé, quand, et le détail Paynovate d'origine,
--      pour que le comptable puisse remonter la chaîne dans six mois.
--   3. ANNULATION — on garde les ids Odoo écrits, donc on sait quoi défaire.
--
-- Le détail des transactions est figé dans `payload` au moment de la
-- validation : le portail Paynovate peut changer, la trace comptable non.
-- Olivier 2026-08-14.

CREATE TABLE IF NOT EXISTS public.payout_reconciliations (
  id                bigserial PRIMARY KEY,

  -- Identité du versement
  provider          text    NOT NULL DEFAULT 'paynovate',   -- 'paynovate' | 'sumup'
  payout_ref        text    NOT NULL,                       -- id de versement chez le prestataire
  customer_ref      text,                                   -- compte marchand (= un terminal)
  terminal_tid      text,                                   -- TID, dit quel site a encaissé
  payout_date       date,
  gross_amount      numeric(12,2),                          -- brut encaissé
  net_amount        numeric(12,2),                          -- net crédité en banque
  commission_amount numeric(12,2),                          -- TVAC — c'est ce qui part en OD

  -- Côté Odoo
  bank_line_id      integer,                                -- account.bank.statement.line
  od_move_id        integer,                                -- l'OD de commission (journal MISC)
  invoice_ids       integer[]  NOT NULL DEFAULT '{}',
  payment_ids       integer[]  NOT NULL DEFAULT '{}',

  -- Suivi
  status            text    NOT NULL DEFAULT 'done',        -- 'done' | 'reverted'
  reconciled_by     uuid    REFERENCES public.users(id),
  reconciled_at     timestamptz NOT NULL DEFAULT now(),
  reverted_at       timestamptz,
  payload           jsonb   NOT NULL DEFAULT '{}'::jsonb,   -- le détail figé
  note              text
);

-- Le garde-fou principal : un versement ne peut être rapproché qu'une fois.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payout_reconciliations_ref
  ON public.payout_reconciliations (provider, payout_ref)
  WHERE status = 'done';

CREATE INDEX IF NOT EXISTS idx_payout_reconciliations_date
  ON public.payout_reconciliations (payout_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_payout_reconciliations_bank_line
  ON public.payout_reconciliations (bank_line_id)
  WHERE bank_line_id IS NOT NULL;

-- Accès service_role uniquement (les API passent par createAdminClient).
ALTER TABLE public.payout_reconciliations DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.payout_reconciliations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.payout_reconciliations_id_seq TO service_role;

COMMENT ON TABLE public.payout_reconciliations IS
  'Versements Paynovate/SumUp rapprochés : idempotence, traçabilité, annulation.';
COMMENT ON COLUMN public.payout_reconciliations.commission_amount IS
  'Commission TVAC retenue à la source. Passe en OD sur le compte fournisseur, sans ventilation TVA : la ventilation se fait sur la facture Paynovate mensuelle.';

-- Recharge le cache PostgREST, sinon les INSERT échouent en silence.
NOTIFY pgrst, 'reload schema';
