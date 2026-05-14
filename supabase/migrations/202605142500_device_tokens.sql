-- ============================================================
-- Tokens des devices pour les push notifications natives
-- ============================================================
-- Chaque app Capacitor (iOS APNs, Android FCM) enregistre son token au
-- backend via POST /api/devices/register. Le helper sendPushNotification
-- lookup les tokens du user et envoie le payload via la bonne API.
--
-- UNIQUE (user_id, token) : evite les doublons si l'app re-register (le
-- second register fait juste un UPDATE de last_seen_at).

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token         text NOT NULL,
  platform      text NOT NULL CHECK (platform IN ('ios', 'android')),
  device_name   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON public.device_tokens (user_id);

-- Permissions explicites (service_role bypass mais on est defensif)
GRANT ALL ON public.device_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;

COMMENT ON TABLE  public.device_tokens IS
  'Tokens APNs (iOS) / FCM (Android) enregistres par les wrappers Capacitor pour recevoir des push notifications.';
