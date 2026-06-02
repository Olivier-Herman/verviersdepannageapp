-- Olivier 2026-06-02 : flag par user pour forcer l usage de l app native
-- (bloquer l acces depuis PWA / navigateur). Cas d usage cible : chauffeur
-- recalcitrant qui refuse d installer l app sur son smartphone de societe.
--
-- Par defaut false (pas de blocage) — Olivier active manuellement par user
-- depuis /admin/users.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS force_native_app boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.force_native_app IS
  'Si true ET role=driver ET acces depuis PWA/Web (pas Capacitor native),
   on bloque tout l usage chauffeur avec un page "Telechargez l app
   native". Override admin uniquement.';

NOTIFY pgrst, 'reload schema';
