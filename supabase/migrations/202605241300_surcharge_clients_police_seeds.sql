-- ============================================================
-- 202605241300_surcharge_clients_police_seeds
-- ============================================================
-- Olivier 2026-05-24 : le seed initial (202605131500) n'avait insere que
-- 'snc' et 'accident_police' dans surcharge_clients. Resultat :
--   - police_saisie : aucune grille de majoration -> fallback snc (incorrect)
--   - police_rodeo, police_avp, police_mg, sia_couvert : idem
--
-- De plus, la cle 'accident_police' ne matche pas la source reelle
-- 'police_accident' (cf lib/surcharges.ts resolveClientKey qui compare
-- mission.source normalisee a surcharge_clients.key). Resultat : les
-- missions Accident faisaient aussi fallback snc.
--
-- Cette migration :
--   1. Ajoute ON UPDATE CASCADE a la FK (necessaire pour renommer la cle)
--   2. Renomme 'accident_police' -> 'police_accident'
--   3. Insere les cles manquantes (police_saisie, police_rodeo, police_avp,
--      police_mg, sia_couvert) — sans plages horaires (l admin les remplit
--      via /admin/surcharges)
--   4. Insere aussi police_snc (different de snc generique)
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

-- 3. Insertion des cles manquantes (toutes kind='hors_assistance')
INSERT INTO public.surcharge_clients (key, label, kind, sort_order) VALUES
  ('police_saisie',  'Police - Saisie',  'hors_assistance', 10),
  ('police_rodeo',   'Police - Rodéo',   'hors_assistance', 11),
  ('police_avp',     'Police - AVP',     'hors_assistance', 12),
  ('police_mg',      'Police - Mal Garée', 'hors_assistance', 13),
  ('police_snc',     'Siabis Non Couvert', 'hors_assistance', 14),
  ('sia_couvert',    'Siabis Couvert',   'assistance',      15)
ON CONFLICT (key) DO NOTHING;

-- 4. Cleanup : supprimer la cle 'fourriere_parc' si elle a ete creee
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
