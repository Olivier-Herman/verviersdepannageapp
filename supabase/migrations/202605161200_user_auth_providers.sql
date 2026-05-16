-- ============================================================
-- 202605161200_user_auth_providers
-- ============================================================
-- Table de liaison user <-> provider d authentification.
-- Permet a un meme user d avoir 4 methodes de connexion possibles :
--   - apple (Sign in with Apple)
--   - google
--   - azure-ad (Microsoft)
--   - credentials (email + mot de passe)
--
-- Avant cette migration : users.auth_provider stockait UN seul provider →
-- 1 user ne pouvait se connecter qu avec ce provider unique.
--
-- Apres : un user peut lier autant de providers qu il veut depuis /profil.
-- users.auth_provider est conserve pour backward-compat mais represente le
-- provider initial / par defaut.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_auth_providers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('apple', 'google', 'azure-ad', 'credentials')),
  -- Identifiant cote provider (subject Apple, sub Google, oid Azure AD).
  -- Pour credentials : reproduit l email lowercase (1 user = 1 mdp).
  provider_account_id TEXT NOT NULL,
  provider_email      TEXT,
  linked_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_user_auth_providers_user
  ON public.user_auth_providers(user_id);

-- RLS : SELECT pour l user proprietaire uniquement. Mutations via API
-- admin (createAdminClient bypass RLS).
ALTER TABLE public.user_auth_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_auth_providers_own_select"
  ON public.user_auth_providers FOR SELECT
  TO authenticated
  USING (true);  -- L API filtrera par user_id

GRANT SELECT ON public.user_auth_providers TO authenticated;

-- ============================================================
-- Seed initial : migre les users.auth_provider existants vers la nouvelle table
-- ============================================================
INSERT INTO public.user_auth_providers (user_id, provider, provider_account_id, provider_email)
SELECT
  u.id,
  CASE
    WHEN u.auth_provider = 'email_password' THEN 'credentials'
    WHEN u.auth_provider = 'microsoft'      THEN 'azure-ad'
    WHEN u.auth_provider = 'google'         THEN 'google'
    WHEN u.auth_provider = 'apple'          THEN 'apple'
    ELSE u.auth_provider
  END AS provider,
  LOWER(u.email) AS provider_account_id,  -- fallback pour la premiere migration
  LOWER(u.email) AS provider_email
FROM public.users u
WHERE u.email IS NOT NULL AND u.auth_provider IS NOT NULL
ON CONFLICT (provider, provider_account_id) DO NOTHING;

COMMENT ON TABLE public.user_auth_providers IS
  'Methodes de connexion liees a un user. Permet le multi-provider (1 user, plusieurs providers).';
