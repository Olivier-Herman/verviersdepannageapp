-- ============================================================
-- 202605182000_aginsurance_source
-- ============================================================
-- 1. Colonne sender_email sur incoming_missions : permet de voir
--    l'adresse expéditrice d'un mail UNKNOWN_SENDER directement dans
--    la page admin/missions (sans devoir ouvrir Outlook).
-- 2. Source "aginsurance" dans le catalogue central. Mails routés via
--    assistance@aginsurance-assistance.be (Touring assistance pour AG
--    Insurance). Client facturé par défaut = Touring (même catalog).
-- ============================================================

-- 1. Colonne sender_email
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS sender_email TEXT;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_sender_email
  ON public.incoming_missions (sender_email)
  WHERE sender_email IS NOT NULL;

-- 2. Source aginsurance (clone des défauts billed_to de touring)
INSERT INTO public.mission_source_catalog (
  key, label, sort_order,
  default_billed_to_id, default_billed_to_name
)
SELECT
  'aginsurance',
  'AG Insurance',
  15,
  default_billed_to_id,
  default_billed_to_name
FROM public.mission_source_catalog
WHERE key = 'touring'
ON CONFLICT (key) DO NOTHING;
