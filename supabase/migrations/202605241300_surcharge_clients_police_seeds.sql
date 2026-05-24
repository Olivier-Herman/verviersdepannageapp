-- ============================================================
-- 202605241300_surcharge_clients_police_seeds
-- ============================================================
-- Olivier 2026-05-24 : le seed initial (202605131500) n'avait insere que
-- 'snc' et 'accident_police' dans surcharge_clients.
--
-- Sources concernees par une majoration horaire (precisions Olivier) :
--   - police_accident : OUI (deja en place, juste a renommer)
--   - police_saisie   : OUI (nouvelle, plages distinctes Accident)
--   - police_snc      : OUI mais memes plages que sia_couvert et snc generique
--                       -> utilise le fallback 'snc' existant (pas besoin de cle)
--   - sia_couvert     : OUI memes regles que police_snc -> fallback 'snc'
--   - police_rodeo    : NON (pas de majoration)
--   - police_avp      : NON
--   - police_mg       : NON
--
-- De plus, la cle 'accident_police' ne matche pas la source reelle
-- 'police_accident' (cf lib/surcharges.ts resolveClientKey qui compare
-- mission.source normalisee a surcharge_clients.key). Resultat : les
-- missions Accident faisaient aussi fallback snc.
--
-- Cette migration :
--   1. Ajoute ON UPDATE CASCADE a la FK (necessaire pour renommer la cle)
--   2. Renomme 'accident_police' -> 'police_accident'
--   3. Insere uniquement 'police_saisie' (les autres police_snc/sia_couvert
--      utilisent le fallback 'snc' existant qui couvre les memes plages)
-- ============================================================

-- 1. Ajout ON UPDATE CASCADE sur la FK pour permettre le renommage
ALTER TABLE public.surcharge_schedules
  DROP CONSTRAINT IF EXISTS surcharge_schedules_client_key_fkey;

ALTER TABLE public.surcharge_schedules
  ADD CONSTRAINT surcharge_schedules_client_key_fkey
  FOREIGN KEY (client_key) REFERENCES public.surcharge_clients(key)
  ON UPDATE CASCADE ON DELETE CASCADE;

-- 2. Renommage accident_police -> police_accident (matche la source)
UPDATE public.surcharge_clients
SET key   = 'police_accident',
    label = 'Police - Accident'
WHERE key = 'accident_police';

-- 3. Insertion des cles necessaires :
--
--    a) police_saisie : a ses propres plages distinctes Accident, sera
--       configuree par l admin.
--
--    b) police_mg, police_rodeo, police_avp : "cles vides" (existent mais
--       sans plages). Necessaire car sans ca, resolveClientKey fait
--       fallback vers 'snc' et appliquerait par erreur les plages snc
--       a ces 3 sources qui n ont pas de majoration. Avec une cle vide,
--       getApplicableSurcharges retourne [] -> aucune majoration.
INSERT INTO public.surcharge_clients (key, label, kind, sort_order) VALUES
  ('police_saisie',  'Police - Saisie',    'hors_assistance', 10),
  ('police_mg',      'Police - Mal Garée', 'hors_assistance', 11),
  ('police_rodeo',   'Police - Rodéo',     'hors_assistance', 12),
  ('police_avp',     'Police - AVP',       'hors_assistance', 13)
ON CONFLICT (key) DO NOTHING;

-- Note : police_mg, police_rodeo, police_avp restent SANS plages horaires.
-- L admin verra ces grilles dans /admin/surcharges mais sans plage configuree.
-- Si une plage est ajoutee ulterieurement (ex: contrat modifie), la majoration
-- s appliquera automatiquement.

-- Note Olivier 2026-05-24 :
-- - police_snc + sia_couvert : memes regles que la grille 'snc' existante.
--   Comme resolveClientKey fait fallback vers 'snc' quand la cle source
--   n'est pas trouvee, on n'a rien a creer pour ces 2 sources.

-- 4. Cleanup defensif : si la version precedente de cette migration
-- (commit ceaf12b) a deja insere police_snc et sia_couvert, on les retire
-- ICI sauf si l admin leur a deja configure des plages personnalisees.
-- Avec ces cles supprimees, resolveClientKey retombe sur le fallback 'snc'
-- qui couvre correctement les memes regles de majoration.
DO $$
DECLARE
  snc_count INTEGER;
  sia_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO snc_count
  FROM public.surcharge_schedules WHERE client_key = 'police_snc';
  SELECT COUNT(*) INTO sia_count
  FROM public.surcharge_schedules WHERE client_key = 'sia_couvert';

  IF snc_count = 0 THEN
    DELETE FROM public.surcharge_clients WHERE key = 'police_snc';
  ELSE
    RAISE NOTICE 'police_snc a % plages configurees, conservation', snc_count;
  END IF;

  IF sia_count = 0 THEN
    DELETE FROM public.surcharge_clients WHERE key = 'sia_couvert';
  ELSE
    RAISE NOTICE 'sia_couvert a % plages configurees, conservation', sia_count;
  END IF;
END $$;

-- 5. Cleanup : supprimer la cle 'fourriere_parc' si elle a ete creee
-- manuellement et qu elle ne sert a rien (aucune mission n a cette source).
-- On ne supprime que si elle n a aucune plage horaire configuree
-- (au cas ou Olivier l aurait configuree intentionnellement avec un sens
-- metier qu on ignore).
DO $$
DECLARE
  schedule_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO schedule_count
  FROM public.surcharge_schedules
  WHERE client_key = 'fourriere_parc';

  IF schedule_count = 0 THEN
    DELETE FROM public.surcharge_clients WHERE key = 'fourriere_parc';
  ELSE
    RAISE NOTICE 'fourriere_parc a % plages horaires configurees, conservation', schedule_count;
  END IF;
END $$;
