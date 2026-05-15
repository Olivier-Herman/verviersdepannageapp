-- ============================================================
-- Fix retro : DISABLE RLS + GRANT sur tables crees sans
-- ============================================================
-- Supabase active RLS par defaut sur les nouvelles tables. Sans DISABLE
-- explicite, les SELECT/INSERT/UPDATE depuis nos API serverless echouent
-- silencieusement (service_role est cense bypass mais avec les configs
-- recentes, GRANT explicite est plus fiable).
--
-- Tables concernees (creees aujourd'hui sans cet ajout) :
--   - dispatcher_on_duty
--   - notification_preferences

ALTER TABLE public.dispatcher_on_duty DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dispatcher_on_duty TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatcher_on_duty TO authenticated;

ALTER TABLE public.notification_preferences DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.notification_preferences TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;

-- Bonus : verifier que notifications_log et device_tokens ont les bons grants
-- (DISABLE deja fait au runtime mais GRANT manquait peut-etre)
GRANT ALL ON public.notifications_log TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications_log TO authenticated;
GRANT SELECT ON public.notifications_log TO anon;  -- pour Realtime

GRANT ALL ON public.device_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO authenticated;
