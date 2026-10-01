-- Talkie téléphone verrouillé (Olivier 01/10/2026) : jeton « Push to Talk » de chaque
-- iPhone (fourni par iOS quand l'app rejoint le canal talkie système). Le serveur
-- réveille le téléphone avec ce jeton quand quelqu'un parle, même app fermée.
CREATE TABLE IF NOT EXISTS public.talkie_ptt_tokens (
  token         text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  keys          text[] NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_push_at  timestamptz,
  last_push_ok  boolean
);
CREATE INDEX IF NOT EXISTS talkie_ptt_tokens_user_idx ON public.talkie_ptt_tokens(user_id);
ALTER TABLE public.talkie_ptt_tokens DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.talkie_ptt_tokens TO service_role;

notify pgrst, 'reload schema';
