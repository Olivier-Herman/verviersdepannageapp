-- Olivier 2026-06-01 : workflow encaisser-avant-creer pour les missions
-- avec paiement immediat obligatoire (Mal Garee deplacement_paye,
-- SNC DSP/REM client, Appel Prive DSP/REM client).
--
-- Nouveau flag awaiting_payment :
--   true  : mission creee en draft, en attente du paiement complet.
--           PAS d envoi TowSoft / email / notif tant que pas finalisee.
--   false : mission active normale.
--
-- Le chauffeur encaisse depuis la fiche mission (eventuellement en plusieurs
-- fois). Quand payment_amount >= amount_to_collect, il peut cliquer
-- "Finaliser" qui passe le flag a false et declenche les hooks normaux
-- (envoi TowSoft, notifs, etc.).

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS awaiting_payment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS draft_params     jsonb;

COMMENT ON COLUMN public.incoming_missions.awaiting_payment IS
  'Mission creee en draft, en attente du paiement complet avant envoi
   TowSoft/notifications. Cf workflow encaisser-avant-creer (Olivier 2026-06-01).';
COMMENT ON COLUMN public.incoming_missions.draft_params IS
  'Snapshot du POST original PoliceClient quand awaiting_payment=true.
   Reutilise par /api/missions/[id]/finalize pour declencher les hooks
   externes (queue TowSoft + helpdesk Odoo + email) au moment de la
   finalisation, une fois le paiement complet.';

-- Index pour le dashboard chauffeur (afficher en haut les missions
-- awaiting_payment qui necessitent encaissement)
CREATE INDEX IF NOT EXISTS idx_incoming_missions_awaiting_payment
  ON public.incoming_missions(assigned_to, awaiting_payment)
  WHERE awaiting_payment = true;

NOTIFY pgrst, 'reload schema';
