-- src/supabase/migrations/202606080200_missions_scratched_at.sql
--
-- Olivier 2026-06-08 : marqueur explicite pour les vehicules mis en epave.
-- Permet de distinguer un completed normal (restitution, sortie classique)
-- d un scratched (epave). Affichage : tampon ROUGE 'EPAVE' sur la fiche QR,
-- desactivation des actions fourriere (Transferer / Domaine / Scratch).

ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS scratched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scratched_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incoming_missions_scratched
  ON public.incoming_missions (scratched_at)
  WHERE scratched_at IS NOT NULL;

COMMENT ON COLUMN public.incoming_missions.scratched_at IS
  'Timestamp de la mise en epave (cf POST /api/missions/[id]/scratch). NULL = pas scratched.';

NOTIFY pgrst, 'reload schema';
