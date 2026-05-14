-- ============================================================
-- Ordre de priorite des chauffeurs (panel /dispatch)
-- ============================================================
-- Permet au dispatcher de classer les chauffeurs par ordre d'importance
-- (drag&drop dans la barre statut). NULL = chauffeur non classe → tombe
-- en fin de liste par defaut (avec tri secondaire alphabetique).
-- L'ordre est global (partage entre tous les dispatchers).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS priority_order int;

COMMENT ON COLUMN public.users.priority_order IS
  'Ordre de priorite affiche dans le panel /dispatch. NULL = non classe (fin de liste). Modifiable par drag&drop par admin/superadmin/dispatcher.';

-- Index pour le tri rapide (NULLS LAST est natif Postgres)
CREATE INDEX IF NOT EXISTS users_priority_order_idx
  ON public.users (priority_order NULLS LAST);
