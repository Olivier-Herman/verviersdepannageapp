-- Olivier 2026-06-02 : ajoute la valeur 'garage' a la contrainte CHECK
-- de users.role. Le constraint d origine vient du setup initial Supabase
-- (pas dans nos migrations versionnees jusqu ici).
--
-- Strategie : DROP + recreate avec toutes les valeurs connues + 'garage'.

DO $$
BEGIN
  -- Drop la contrainte existante si presente (nom standard Supabase)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_check'
    AND   conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT users_role_check;
  END IF;
END $$;

-- Recree avec garage inclus
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'driver',
    'dispatcher',
    'admin',
    'superadmin',
    'facturation',
    'fourriere',
    'garage'
  ));

NOTIFY pgrst, 'reload schema';
