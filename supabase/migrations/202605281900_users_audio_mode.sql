-- Olivier 2026-05-28 : flag audio_mode pour les chauffeurs qui ne savent pas
-- lire (ou preferent une assistance audio).
--
-- Active :
-- - Long-press universel sur tout texte de l app -> lecture a voix haute
-- - Eventuelle UI adaptee (boutons plus gros, etc.) dans le futur
--
-- Les boutons 🔊 cibles dans la fiche mission sont toujours visibles
-- (pour tout le monde) — c est juste un raccourci pratique. Le mode
-- audio active uniquement le long-press global.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS audio_mode BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.audio_mode IS
  'Active le mode assistance audio : long-press sur tout texte = lecture a voix haute. Cible chauffeurs non-lecteurs. Olivier 2026-05-28.';

NOTIFY pgrst, 'reload schema';
