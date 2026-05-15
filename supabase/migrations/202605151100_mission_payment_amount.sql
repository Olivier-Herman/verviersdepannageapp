-- ============================================================
-- 202605151100_mission_payment_amount
-- ============================================================
-- Ajoute le montant reellement encaisse a cote de payment_collected_at +
-- payment_mode (cf migration 202605151000_mission_payment_link).
--
-- Pourquoi : amount_to_collect = montant PREVU par le dispatcher a la
-- creation de la mission. Le chauffeur peut encaisser un montant different
-- (negociation client, correction, paiement partiel ulterieur...). Sans
-- cette colonne, l'annotation cote mission montre l'amount_to_collect au
-- lieu du montant reellement paye → bug constate (200 EUR prevu, 0.01 EUR
-- paye, mission affichait "Payee : 200 EUR").
-- ============================================================

ALTER TABLE public.incoming_missions
ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10,2);

COMMENT ON COLUMN public.incoming_missions.payment_amount IS
  'Montant reellement encaisse par le chauffeur (peut differer de amount_to_collect en cas de negociation, correction, etc.).';
