-- ============================================================
-- Preferences de notifications par user × type
-- ============================================================
-- Une ligne = une preference explicite. L'absence de ligne signifie
-- "default enable" SI le type est applicable au role de l'user
-- (cf src/lib/notifications/types.ts pour la liste figee + role mapping).
--
-- L'admin configure via /admin/notifications. Pas de surcouche perso
-- pour l'instant (centralise pour gouvernance).

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id    uuid    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notif_type text    NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notif_type)
);

CREATE INDEX IF NOT EXISTS notification_preferences_user_idx
  ON public.notification_preferences (user_id);

COMMENT ON TABLE public.notification_preferences IS
  'Preferences user × type de notification. Configure par admin via /admin/notifications.';
