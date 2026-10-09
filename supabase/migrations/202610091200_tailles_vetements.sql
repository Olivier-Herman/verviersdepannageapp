-- Commande de pulls et t-shirts (module temporaire, Olivier 09/10/2026) : tailles de
-- chaque membre du personnel. La campagne (active, exclus) vit dans app_settings
-- « campagne_vetements ».
CREATE TABLE IF NOT EXISTS public.tailles_vetements (
  user_id     uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  tshirt      text NOT NULL,
  pull        text NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tailles_vetements DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.tailles_vetements TO service_role;

notify pgrst, 'reload schema';
