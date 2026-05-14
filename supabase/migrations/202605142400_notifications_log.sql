-- ============================================================
-- Historique des notifications envoyees + Realtime
-- ============================================================
-- Toutes les notifs envoyees (in-app, push, phone) sont loggees ici
-- pour tracabilite + le canal in-app Supabase Realtime ecoute les INSERT
-- filtres par user_id pour afficher un bandeau live.

CREATE TABLE IF NOT EXISTS public.notifications_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notif_type    text NOT NULL,                  -- doit matcher src/lib/notifications/types.ts
  payload       jsonb,                          -- payload custom par type (title, body, missionId, etc.)
  channel       text NOT NULL DEFAULT 'in_app', -- 'in_app' | 'push' | 'phone'
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,                    -- quand l'utilisateur a vu la notif
  responded_at  timestamptz,                    -- quand l'utilisateur a interagi (clic, accept, dismiss)
  response      jsonb                           -- payload de la reponse (ex: { action: 'accept' })
);

CREATE INDEX IF NOT EXISTS notifications_log_user_created_idx
  ON public.notifications_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_log_user_unread_idx
  ON public.notifications_log (user_id) WHERE read_at IS NULL;

COMMENT ON TABLE  public.notifications_log IS
  'Historique de toutes les notifications envoyees aux users. Realtime active pour le canal in_app.';
COMMENT ON COLUMN public.notifications_log.payload IS
  'Contenu structure : { title, body, sound?, action_url?, mission_id?, ... }';

-- ============================================================
-- Realtime : autoriser les INSERT a etre stream aux clients connectes
-- ============================================================
-- Le client souscrit avec filter=`user_id=eq.${session.user.id}` pour
-- ne recevoir que ses propres notifs.

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications_log;
