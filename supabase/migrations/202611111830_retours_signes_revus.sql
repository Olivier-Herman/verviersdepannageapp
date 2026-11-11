-- Retours signés que le robot n'a pas su lire (P2, Olivier 11/11/2026) : la file
-- « Pages à attribuer » de l'écran États de frais. revu_at = traité à la main
-- (attribué à un état de frais, ou écarté).
ALTER TABLE public.saisie_mail_events ADD COLUMN IF NOT EXISTS revu_at timestamptz;
ALTER TABLE public.saisie_mail_events ADD COLUMN IF NOT EXISTS revu_par uuid;

NOTIFY pgrst, 'reload schema';
