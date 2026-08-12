-- Rattachements manuels d'une référence terminal à une ou plusieurs factures.
--
-- La référence tapée au terminal n'est pas toujours résolvable : plaque absente
-- du parc, référence tronquée, facture annulée depuis l'encaissement. Quand
-- l'utilisateur retrouve la bonne facture, on l'enregistre ICI plutôt que de
-- traiter le cas à la volée.
--
-- Le résolveur consulte cette table EN PREMIER. Conséquence : le versement
-- redevient « prêt » par le chemin normal, et le rapprochement garde tous ses
-- garde-fous — aucune écriture privilégiée, aucun contournement.
-- Bénéfice au passage : la même référence tapée deux fois ne se retrouve
-- qu'une seule fois. Olivier 2026-08-14.

CREATE TABLE IF NOT EXISTS public.payout_reference_overrides (
  id            bigserial PRIMARY KEY,
  provider      text    NOT NULL DEFAULT 'paynovate',
  merchant_ref  text    NOT NULL,               -- ce qui a été tapé au terminal
  amount        numeric(12,2) NOT NULL,         -- montant encaissé, pour lever l'ambiguïté
  invoice_ids   integer[] NOT NULL,             -- une ou plusieurs factures Odoo
  invoice_names text[]    NOT NULL DEFAULT '{}',-- lisible, pour l'écran et l'audit
  created_by    uuid    REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  note          text
);

-- Une même référence peut revenir pour des montants différents (véhicule qui
-- repasse) : c'est le couple référence + montant qui identifie l'encaissement.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payout_ref_override
  ON public.payout_reference_overrides (provider, merchant_ref, amount);

ALTER TABLE public.payout_reference_overrides DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.payout_reference_overrides TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.payout_reference_overrides_id_seq TO service_role;

COMMENT ON TABLE public.payout_reference_overrides IS
  'Référence terminal → facture(s), saisie à la main quand la résolution automatique échoue. Consultée en premier par le résolveur.';

NOTIFY pgrst, 'reload schema';
