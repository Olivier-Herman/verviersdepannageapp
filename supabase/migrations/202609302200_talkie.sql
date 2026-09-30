-- Talkie « Garde de nuit » (Olivier 30/09/2026) : talkie-walkie en direct dans l'app
-- entre le 1er départ et la réserve de la nuit ; les superadmins peuvent écouter.
-- La voix passe en direct par Supabase Realtime (diffusion) ; chaque prise de parole
-- est aussi enregistrée (réécoute si l'autre n'avait pas l'app ouverte, historique).
-- Les chauffeurs sont informés à l'écran que le canal est enregistré et peut être
-- écouté par la direction. Cf src/lib/talkie/*.ts et /talkie.
CREATE TABLE IF NOT EXISTS public.talkie_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  night_key     text NOT NULL,                     -- nuit de garde (YYYY-MM-DD du soir)
  sender_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  duration_ms   integer NOT NULL DEFAULT 0,
  storage_path  text NOT NULL,                     -- bucket « talkie » (privé)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_talkie_messages_night ON public.talkie_messages (night_key, created_at DESC);

ALTER TABLE public.talkie_messages DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.talkie_messages TO service_role;

INSERT INTO storage.buckets (id, name, public) VALUES ('talkie', 'talkie', false) ON CONFLICT (id) DO NOTHING;

notify pgrst, 'reload schema';
