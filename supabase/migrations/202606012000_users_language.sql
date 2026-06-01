-- Olivier 2026-06-01 : preference de langue par user pour i18n.
-- Cas d usage initial : un chauffeur lit l albanais, pas le francais.
-- Format bilingue prevu cote UI : "texte sq (texte fr)" pour que le dispatcher
-- (Olivier) puisse aider le chauffeur sans parler albanais.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr'
    CHECK (language IN ('fr', 'sq'));

COMMENT ON COLUMN public.users.language IS
  'Langue d affichage de l UI (cible : ecrans chauffeur). Defaut fr.
   sq = Albanais (Shqip). En mode sq, le texte francais est affiche
   en plus petit entre parentheses pour aider le dispatcher.';

NOTIFY pgrst, 'reload schema';
