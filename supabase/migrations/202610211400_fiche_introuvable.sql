-- Fiches « introuvables » (Olivier 21/10/2026, contrôle du parc) : la voiture n'a pas été retrouvée au parc
-- et rien n'explique sa sortie. La fiche quitte les listes du parc mais reste trouvable par la recherche,
-- avec un tampon « INTROUVABLE » et un bandeau d'explication (ce qui a été trouvé à son sujet).
alter table public.incoming_missions
  add column if not exists introuvable_at   timestamptz,
  add column if not exists introuvable_note text;

notify pgrst, 'reload schema';
