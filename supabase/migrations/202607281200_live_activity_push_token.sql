-- Stocke le push token ActivityKit de la Live Activity (pour pousser les
-- mises à jour temps réel quand l'app chauffeur est suspendue). Olivier 2026-07-28.
ALTER TABLE public.incoming_missions
  ADD COLUMN IF NOT EXISTS live_activity_push_token text;

NOTIFY pgrst, 'reload schema';
