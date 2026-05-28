-- Olivier 2026-05-28 : table evaluations pour le module de test app par Jona.
-- Page /evaluation cachee (pas dans la nav), accessible via URL directe partagee
-- aux testeurs externes. Chaque user connecte enregistre ses evaluations
-- fonction par fonction.

CREATE TABLE IF NOT EXISTS public.evaluations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  function_id     TEXT NOT NULL,         -- ex: "13", "100", "45" (numero du catalog test)
  function_label  TEXT NOT NULL,         -- copie du label pour traçabilite si catalog change
  status          TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'skipped')),
  ux_rating       INTEGER CHECK (ux_rating BETWEEN 1 AND 5),
  ui_rating       INTEGER CHECK (ui_rating BETWEEN 1 AND 5),
  comment         TEXT,
  suggestion      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT evaluations_user_function_uniq UNIQUE (user_id, function_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluations_user_id ON public.evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_created_at ON public.evaluations(created_at DESC);

ALTER TABLE public.evaluations DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.evaluations TO service_role;

COMMENT ON TABLE public.evaluations IS
  'Evaluations utilisateur sur les fonctionnalites de l app (testeurs externes type Jona). Page /evaluation cachee, accessible via URL directe. Olivier 2026-05-28.';

NOTIFY pgrst, 'reload schema';
