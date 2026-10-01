-- Talkie : journal du module iPhone (Olivier 01/10/2026) — seul moyen de voir ce qui se
-- passe sur un téléphone verrouillé sans le brancher. Purge simple : on garde 14 jours
-- (à supprimer à la main ou par cron plus tard).
CREATE TABLE IF NOT EXISTS public.talkie_native_logs (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES public.users(id) ON DELETE CASCADE,
  channel_key text,
  version     text,
  device      text,
  t           timestamptz,
  msg         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS talkie_native_logs_user_idx ON public.talkie_native_logs(user_id, id DESC);
ALTER TABLE public.talkie_native_logs DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.talkie_native_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.talkie_native_logs_id_seq TO service_role;

notify pgrst, 'reload schema';
