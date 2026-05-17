-- ============================================================
-- 202605171700_watch_device_tokens
-- ============================================================
-- Apple Watch Niveau 3 : la Watch enregistre son token APNs separement
-- de l iPhone (meme user, devices distincts, topic APNs different).
--
-- On etend la contrainte CHECK de device_tokens.platform pour autoriser
-- 'watchos'. Le helper sendApnsPush envoie sur le topic
-- `${APNS_BUNDLE_ID}.watchkitapp` quand la platform est 'watchos'.
-- ============================================================

ALTER TABLE public.device_tokens
  DROP CONSTRAINT IF EXISTS device_tokens_platform_check;

ALTER TABLE public.device_tokens
  ADD CONSTRAINT device_tokens_platform_check
  CHECK (platform IN ('ios', 'android', 'watchos'));

COMMENT ON COLUMN public.device_tokens.platform IS
  'ios = iPhone APNs · android = FCM · watchos = Apple Watch APNs (topic .watchkitapp)';
