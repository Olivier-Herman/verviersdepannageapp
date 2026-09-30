-- Talkie : présence côté serveur (Olivier 30/09/2026). La présence temps réel du
-- navigateur ne tombait pas quand l'app iPhone passait en arrière-plan → aucune notif.
-- L'app à l'écran signale sa présence toutes les 10 s (et « je pars » en quittant
-- l'écran) ; le serveur notifie ceux dont le dernier signal a plus de 25 s.
CREATE TABLE IF NOT EXISTS public.talkie_presence (
  user_id  uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  seen_at  timestamptz
);
ALTER TABLE public.talkie_presence DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.talkie_presence TO service_role;

notify pgrst, 'reload schema';
