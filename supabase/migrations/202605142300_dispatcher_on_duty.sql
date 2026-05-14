-- ============================================================
-- Dispatcher de garde (singleton)
-- ============================================================
-- Une seule ligne : id=1, user_id = le dispatcher actuellement responsable
-- des escalades (auto-dispatch sans reponse, appels police, etc.).
-- Modifiable par admin/superadmin/dispatcher via badge dans /dispatch.

CREATE TABLE IF NOT EXISTS public.dispatcher_on_duty (
  id      int PRIMARY KEY DEFAULT 1,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  set_at  timestamptz NOT NULL DEFAULT now(),
  set_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT dispatcher_on_duty_singleton CHECK (id = 1)
);

-- Bootstrap : ligne unique vide (sera assignee au 1er clic dans l'UI)
INSERT INTO public.dispatcher_on_duty (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.dispatcher_on_duty IS
  'Dispatcher responsable des escalades (auto-dispatch timeout, appels police). Singleton (id=1).';
