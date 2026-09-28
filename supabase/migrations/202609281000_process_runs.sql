-- ============================================================
-- 202609281000_process_runs
-- ============================================================
-- Module Tâches — premier jet (Olivier, spec validée le 28/09/2026).
--
-- Un « run » = la prise en charge d'un véhicule par un process, question par
-- question. Premier process : « Accident sur appel police », qui démarre à la
-- dépose au parc par le chauffeur et se joue entièrement à la fourrière.
-- Les réponses vivent ici (answers) ; les effets de bord (clé, zone, photos,
-- client facturable, adresse de relivraison…) sont écrits sur la fiche par les
-- API existantes, pour que la fiche reste la source de vérité.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.process_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id    uuid NOT NULL REFERENCES public.incoming_missions(id) ON DELETE CASCADE,
  process_key   text NOT NULL DEFAULT 'accident_police',
  status        text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'waiting_owner', 'done')),
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { label:'oui', key:'crochet', key_hook:'12', … }
  reading       jsonb,                                -- ce que la lecture des documents a compris
  started_by    uuid REFERENCES public.users(id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, process_key)
);

CREATE INDEX IF NOT EXISTS idx_process_runs_status ON public.process_runs (process_key, status, updated_at DESC);

ALTER TABLE public.process_runs DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.process_runs TO service_role;

-- Pilote : superadmins + Jona (fourrière), comme les autres chantiers.
INSERT INTO public.feature_flags (key, mode, label, pilot_user_ids)
VALUES ('taches_accident', 'superadmin', 'Tâches — prise en charge accident police (fourrière)', ARRAY['eda29707-c9c7-47b5-ab21-084ea22201bc']::uuid[])
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
