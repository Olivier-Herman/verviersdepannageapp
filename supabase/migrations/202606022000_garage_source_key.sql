-- Olivier 2026-06-02 : refonte tarification garage.
-- Au lieu d une table dediee garage_tariffs (3 prix par garage), chaque
-- garage devient une "source" canonique dans mission_source_catalog. Le
-- systeme source_tariffs existant (deja utilise pour les assurances) gere
-- prise en charge + km inclus + km price + surcharges + horaires par
-- (source, mission_type).
--
-- L admin configure les tarifs garage dans /admin/tarifs comme pour les
-- assurances. Plus de code dedie, plus de double maintenance.

-- Drop la table tarif dediee (pas necessaire, source_tariffs prend le relais)
DROP TABLE IF EXISTS public.garage_tariffs;

-- Cle source dans mission_source_catalog
ALTER TABLE public.garage_partners
  ADD COLUMN IF NOT EXISTS source_key text UNIQUE;

-- Backfill : genere une cle pour les garages deja crees
DO $$
DECLARE
  g RECORD;
  k text;
BEGIN
  FOR g IN SELECT id, name FROM public.garage_partners WHERE source_key IS NULL LOOP
    k := 'garage_' || substr(md5(g.id::text || random()::text), 1, 6);
    UPDATE public.garage_partners SET source_key = k WHERE id = g.id;
    INSERT INTO public.mission_source_catalog (key, label, sort_order)
    VALUES (k, g.name, 200)
    ON CONFLICT (key) DO NOTHING;
  END LOOP;
END $$;

ALTER TABLE public.garage_partners
  ALTER COLUMN source_key SET NOT NULL;

COMMENT ON COLUMN public.garage_partners.source_key IS
  'Cle dans mission_source_catalog (format garage_XXXXXX, stable). Utilisee
   comme source d incoming_missions pour matcher les tarifs dans
   source_tariffs (meme pattern que touring, ethias, etc.).';

NOTIFY pgrst, 'reload schema';
