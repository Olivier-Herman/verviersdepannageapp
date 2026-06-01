-- Olivier 2026-06-01 : flag pour desactiver le modal de confirmation truck
-- pour certains users (ex: dispatchers qui ne conduisent jamais, admins, etc.).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS truck_confirm_disabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.truck_confirm_disabled IS
  'Si true, le modal de confirmation truck (7h/17h) ne s affiche jamais pour cet user. Pour les users qui ne conduisent pas de depanneuse VD (admin pur, facturation, etc.). Olivier 2026-06-01.';

NOTIFY pgrst, 'reload schema';
