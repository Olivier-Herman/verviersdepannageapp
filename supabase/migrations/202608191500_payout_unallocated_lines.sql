-- Encaissements reçus mais non affectés à une facture.
--
-- Certaines transactions n'ont aucune référence exploitable : le chauffeur a
-- tapé « Montant personnalisé » sur le terminal, et rien ne permet de remonter
-- à la facture. L'argent est pourtant bien arrivé sur le compte, et la ligne
-- bancaire doit se lettrer — sinon elle reste dans la file pour toujours.
--
-- On enregistre donc la décision « passer cette ligne en OD » ICI, et le
-- rapprochement produit l'écriture correspondante :
--
--     542 Paiements entrants en suspens   montant D   → rejoint le lettrage
--     499000 Suspense Accounts            montant C   → en attente d'affectation
--
-- C'est l'équivalent traçable des « enveloppes de commission » saisies à la
-- main jusqu'ici : une écriture par ligne, avec qui a décidé, quand, et
-- pourquoi. Si la facture refait surface, on sait exactement quoi régulariser.
-- Olivier 2026-08-19.

CREATE TABLE IF NOT EXISTS public.payout_unallocated_lines (
  id          bigserial PRIMARY KEY,
  provider    text    NOT NULL,                  -- 'paynovate' | 'sumup'

  -- Même clé que les rattachements manuels : la référence terminal quand il y
  -- en a une, sinon l'identifiant de la transaction chez le prestataire.
  link_key    text    NOT NULL,
  amount      numeric(12,2) NOT NULL,            -- le BRUT encaissé

  account_id  integer NOT NULL DEFAULT 265,      -- 499000 Suspense Accounts
  reason      text,                              -- en clair, pour le comptable

  created_by  uuid    REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Une même référence peut revenir pour des montants différents : c'est le
-- couple clé + montant qui identifie l'encaissement, comme pour les
-- rattachements manuels.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payout_unallocated
  ON public.payout_unallocated_lines (provider, link_key, amount);

ALTER TABLE public.payout_unallocated_lines DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.payout_unallocated_lines TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.payout_unallocated_lines_id_seq TO service_role;

COMMENT ON TABLE public.payout_unallocated_lines IS
  'Encaissements carte reçus sans facture identifiable : passés en OD sur le compte d''attente pour débloquer le lettrage de la ligne bancaire.';

NOTIFY pgrst, 'reload schema';
