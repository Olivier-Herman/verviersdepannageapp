-- Olivier 2026-06-01 (demande Franck) : motif obligatoire pour les missions
-- Police-Saisie. Configurable par admin via /admin/saisie-motifs.
-- Le code du motif apparait sur l etiquette parc a la place de "SAISIE".

CREATE TABLE IF NOT EXISTS public.police_saisie_motifs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,    -- ex: 'DEFAUT_ASSURANCE', 'ALCOOL', etc.
  label       text NOT NULL,           -- ex: 'Défaut assurance'
  label_short text,                    -- version courte pour etiquette (max 20 chars). Fallback sur label si null.
  icon        text,                    -- emoji ou code (ex: '📄', '🍺', etc.)
  sort_order  int NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psm_active_sort
  ON public.police_saisie_motifs(sort_order, label) WHERE active = true;

ALTER TABLE public.police_saisie_motifs DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.police_saisie_motifs TO service_role;
GRANT SELECT ON public.police_saisie_motifs TO authenticated;

COMMENT ON TABLE public.police_saisie_motifs IS
  'Motifs de saisie Police (cf demande Franck 2026-06-01). Geres dans /admin/saisie-motifs. Aucun seed initial — admin doit les saisir.';
COMMENT ON COLUMN public.police_saisie_motifs.label_short IS
  'Label court pour etiquette parc (max 20 chars). Si null, label est utilise (tronque par le template ZPL si trop long).';

-- Colonne sur incoming_missions : code du motif (snapshot, pas FK pour resilience)
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS saisie_motif_code  text,
  ADD COLUMN IF NOT EXISTS saisie_motif_label text;

COMMENT ON COLUMN public.incoming_missions.saisie_motif_code IS
  'Code du motif de saisie choisi par le chauffeur (police_saisie_motifs.code). Snapshot a la creation.';
COMMENT ON COLUMN public.incoming_missions.saisie_motif_label IS
  'Label du motif au moment de la saisie (snapshot). Resilient si le motif est renomme/supprime apres coup.';

NOTIFY pgrst, 'reload schema';
